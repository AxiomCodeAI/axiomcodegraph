import Parser from 'tree-sitter';

import {
  PyImportRegistry,
  PyMethodParameterRegistry,
  PyMethodRegistry,
  PyModuleRegistry,
  PyTypeBaseRegistry,
  PyTypeRegistry,
} from '@/analysis-types/python';
import {
  PYTHON_CLASS_INITIALIZER_NAME,
  PYTHON_LAMBDA_METHOD_NAME,
  PYTHON_MODULE_INITIALIZER_NAME,
} from '@/constants/python-constants';
import { PythonImportKind } from '@/enums/python/imports';
import {
  PythonDefaultValueKind,
  PythonMethodAccess,
  PythonMethodKind,
  PythonMethodModifier,
  PythonParameterKind,
} from '@/enums/python/methods';
import {
  PythonBaseKind,
  PythonMroKind,
  PythonTypeAccess,
  PythonTypeCategory,
  PythonTypeModifier,
  PythonTypePlacement,
} from '@/enums/python/types';
import {
  PythonTypeRefContext,
  PythonTypeRefOwnerKind,
} from '@/enums/python/type-references';
import { TypePositionInput } from '@/parsers/python/extractors/python-type-reference-extractor';
import { EntityUtils } from '@/utils/entity-utils';
import { PythonSourcePositions } from '@/utils/python';

/** What the declaration stage produces for one module. */
export interface PythonDeclarationExtraction {
  types: PyTypeRegistry[];
  typeBases: PyTypeBaseRegistry[];
  methods: PyMethodRegistry[];
  methodParameters: PyMethodParameterRegistry[];
  imports: PyImportRegistry[];

  /** `function_definition` node id -> `py_method` PK, for the expression stage. */
  methodHashByNodeId: Map<number, string>;
  /** `class_definition` node id -> `py_type` PK. */
  typeHashByNodeId: Map<number, string>;
  /** `class_definition` node id -> its `<classbody>` method PK. */
  classInitHashByNodeId: Map<number, string>;
  /** The synthetic `<module>` method PK — the fallback expression owner. */
  moduleMethodHash: string;
  /**
   * `lambda` node id -> its `py_method` PK.
   *
   * A lambda is a real `py_method` (schema §2.7 lists `lambda` alongside `def`),
   * so its scope has an owner and its body's expressions and calls are
   * attributed to IT rather than to the function it happens to sit in.
   */
  lambdaMethodByNodeId: Map<number, string>;
  /**
   * `py_method_parameter` PK -> the `startIndex:endIndex` of its default-value
   * expression. Joined against the expression stage's byte-range index, since
   * the two stages mint their rows independently.
   */
  parameterDefaultByteRange: Map<string, string>;
  /**
   * Annotation node `startIndex:endIndex` -> the `py_method_parameter` PK it
   * annotates.
   *
   * Lets the expression stage make a parameter's annotation subtree OWNED by
   * that parameter, which is what `expressionOwnerKind=METHOD_PARAMETER` exists
   * for. Without it there is no way to get from a parameter row to the N type
   * references in its annotation — and a parameter row has only ONE
   * `potentialQualifiedName` slot, so `Dict[TypeA, TypeB]` cannot be expressed
   * there at all.
   */
  parameterHashByAnnotationRange: Map<string, string>;
  /**
   * Scope-introducing `node.id` -> the PK of the entity that OWNS that scope: a
   * `py_type` for a class body, a `py_method` for a function or lambda. Used to
   * back-patch `py_scope.ownerHash`, which cannot be known when the scope row is
   * minted because the declaration does not exist yet.
   */
  scopeOwnerByNodeId: Map<number, string>;
  /**
   * Scope-introducing `node.id` -> the enclosing `py_method` PK, for
   * `py_binding.pyMethodLinkHash`.
   */
  enclosingMethodByScopeNodeId: Map<number, string>;
}

export interface PythonDeclarationInput {
  module: PyModuleRegistry;
  rootNode: Parser.SyntaxNode;
  filePath: string;
  baseMservPath: string;
  fileName: string;
  serviceVersionLinkHash: string;
  /** Scope-introducing `node.id` -> `py_scope` PK, from the scope stage. */
  scopeHashByNodeId: Map<number, string>;
  /** `(scopeHash, name)` -> `py_binding` PK, from the scope stage. */
  bindingHashByScopeAndName: Map<string, string>;
  /** Scope-introducing `node.id` -> the scope's qualified name. */
  qualifiedNameByNodeId: Map<number, string>;
  /** Converts tree-sitter character columns to CPython UTF-8 byte columns. */
  positions: PythonSourcePositions;
}

/** Lexical context threaded through the walk. */
interface DeclarationContext {
  /** Enclosing `py_type` PK, or `''` at module level. */
  enclosingTypeHash: string;
  enclosingTypeName: string;
  enclosingTypeQualifiedName: string;
  /** Enclosing `py_method` PK — the synthetic `<module>` at worst, never `''`. */
  enclosingMethodHash: string;
  /** The scope PK a declaration's *name* is bound in. */
  bindingScopeHash: string;
  /** True inside a class body, where a `def` becomes a method. */
  inClassBody: boolean;
  /** True inside a function body, where a `class` is LOCAL_PLACEMENT. */
  inFunctionBody: boolean;
  /** True under `if`/`try` at module level. */
  isConditional: boolean;
  /** True under `if TYPE_CHECKING:` — absent at runtime. */
  isTypeCheckingOnly: boolean;
}

/**
 * Emits the declaration relations: `py_type`, `py_type_base`, `py_method`,
 * `py_method_parameter` and `py_import`.
 *
 * Stage 2 of the build order. Where stage 1 is adjudicated *exactly* by
 * `symtable`, this stage is cross-checked against `ast` — a second
 * implementation, so a disagreement means "adjudicate", not automatically "we
 * are wrong".
 *
 * ## The two synthetic methods
 *
 * Python allows executable code where Java cannot: at module level (3,006
 * statements across 826 measured files) and in class bodies. But
 * `expr_ultimate_method` in the resolution layer requires every expression to
 * reach a method or call attribution silently fails. So this extractor mints:
 *
 * - one `<module>` method per module (`MODULE_INITIALIZER`), owning module-level
 *   code, and
 * - one `<classbody>` method per class (`CLASS_INITIALIZER`).
 *
 * Both carry the `SYNTHETIC` modifier. This is the same move the Java parser
 * already makes for `<clinit>` / `<init>` initializer blocks, which is why the
 * whole call-chain layer works on Python with no new rules.
 *
 * ## State discipline
 *
 * Context is threaded as an explicit parameter, never written onto nodes.
 * node-tree-sitter's wrapper cache evicts entries, so a tag set while
 * descending is gone on the way back up — an error that passes every small test
 * and corrupts large files silently.
 */
export class PythonDeclarationExtractor {
  private input!: PythonDeclarationInput;
  private types: PyTypeRegistry[] = [];
  private typeBases: PyTypeBaseRegistry[] = [];
  private methods: PyMethodRegistry[] = [];
  private methodParameters: PyMethodParameterRegistry[] = [];
  private imports: PyImportRegistry[] = [];
  private methodHashByNodeId = new Map<number, string>();
  private typeHashByNodeId = new Map<number, string>();
  private classInitHashByNodeId = new Map<number, string>();
  private parameterDefaultByteRange = new Map<string, string>();
  private parameterHashByAnnotationRange = new Map<string, string>();
  private typePositions: TypePositionInput[] = [];
  private lambdaMethodByNodeId = new Map<number, string>();
  private scopeOwnerByNodeId = new Map<number, string>();
  private enclosingMethodByScopeNodeId = new Map<number, string>();

  extract(input: PythonDeclarationInput): PythonDeclarationExtraction {
    this.input = input;
    this.types = [];
    this.typeBases = [];
    this.methods = [];
    this.methodParameters = [];
    this.imports = [];
    this.methodHashByNodeId = new Map();
    this.typeHashByNodeId = new Map();
    this.classInitHashByNodeId = new Map();
    this.parameterDefaultByteRange = new Map();
    this.parameterHashByAnnotationRange = new Map();
    this.typePositions = [];
    this.lambdaMethodByNodeId = new Map();
    this.scopeOwnerByNodeId = new Map();
    this.enclosingMethodByScopeNodeId = new Map();

    const moduleScopeHash = input.scopeHashByNodeId.get(input.rootNode.id) ?? '';
    const moduleInit = this.emitModuleInitializer(moduleScopeHash);
    input.module.setModuleInitMethodLinkHash(moduleInit.getHash());
    // The module scope is owned by the module itself, and module-level bindings
    // belong to the synthetic <module> method.
    this.scopeOwnerByNodeId.set(input.rootNode.id, input.module.getHash());
    this.enclosingMethodByScopeNodeId.set(input.rootNode.id, moduleInit.getHash());

    this.visitBody(input.rootNode, {
      enclosingTypeHash: '',
      enclosingTypeName: '',
      enclosingTypeQualifiedName: '',
      enclosingMethodHash: moduleInit.getHash(),
      bindingScopeHash: moduleScopeHash,
      inClassBody: false,
      inFunctionBody: false,
      isConditional: false,
      isTypeCheckingOnly: false,
    });

    // Lambdas are expressions, so the statement walk above does not reach them.
    // They get their own pass, which threads the same owner context.
    this.emitLambdaMethods(input.rootNode, '', moduleInit.getHash());
    this.propagateCategoriesThroughLocalBases();

    return {
      types: this.types,
      typeBases: this.typeBases,
      methods: this.methods,
      methodParameters: this.methodParameters,
      imports: this.imports,
      methodHashByNodeId: this.methodHashByNodeId,
      typeHashByNodeId: this.typeHashByNodeId,
      classInitHashByNodeId: this.classInitHashByNodeId,
      moduleMethodHash: moduleInit.getHash(),
      parameterDefaultByteRange: this.parameterDefaultByteRange,
      parameterHashByAnnotationRange: this.parameterHashByAnnotationRange,
      typePositions: this.typePositions,
      lambdaMethodByNodeId: this.lambdaMethodByNodeId,
      scopeOwnerByNodeId: this.scopeOwnerByNodeId,
      enclosingMethodByScopeNodeId: this.enclosingMethodByScopeNodeId,
    };
  }

  // ------------------------------------------------------------- synthetics

  /**
   * Mints the `<module>` initializer.
   *
   * Its span is the whole file, so every module-level expression falls inside an
   * owner. `pyTypeLinkHash` is empty, which is correct: a module is not a type.
   */
  private emitModuleInitializer(moduleScopeHash: string): PyMethodRegistry {
    const root = this.input.rootNode;
    const method = PyMethodRegistry.builder(
      PYTHON_MODULE_INITIALIZER_NAME,
      `${PYTHON_MODULE_INITIALIZER_NAME}()`,
      `${this.input.module.getQualifiedName()}.${PYTHON_MODULE_INITIALIZER_NAME}`,
      this.input.filePath,
      root.startPosition.row + 1,
      root.endPosition.row + 1,
      this.input.positions.byteColumn(root.startPosition.row, root.startPosition.column),
      this.input.module.getHash(),
      this.input.serviceVersionLinkHash
    )
      .withKindAndAccess(PythonMethodKind.MODULE_INITIALIZER, PythonMethodAccess.PUBLIC_ACCESS)
      .withModifiers([PythonMethodModifier.SYNTHETIC])
      .withScopeLinkHash(moduleScopeHash)
      .withEndColumn(this.input.positions.byteColumn(root.endPosition.row, root.endPosition.column))
      .build();
    this.methods.push(method);
    return method;
  }

  /** Mints the `<classbody>` initializer for one class. */
  private emitClassInitializer(
    classNode: Parser.SyntaxNode,
    type: PyTypeRegistry,
    classScopeHash: string
  ): PyMethodRegistry {
    const method = PyMethodRegistry.builder(
      PYTHON_CLASS_INITIALIZER_NAME,
      `${PYTHON_CLASS_INITIALIZER_NAME}()`,
      `${type.getQualifiedName()}.${PYTHON_CLASS_INITIALIZER_NAME}`,
      this.input.filePath,
      classNode.startPosition.row + 1,
      classNode.endPosition.row + 1,
      this.input.positions.byteColumn(classNode.startPosition.row, classNode.startPosition.column),
      this.input.module.getHash(),
      this.input.serviceVersionLinkHash
    )
      .withKindAndAccess(PythonMethodKind.CLASS_INITIALIZER, PythonMethodAccess.PUBLIC_ACCESS)
      .withModifiers([PythonMethodModifier.SYNTHETIC])
      .withOwner(type.getHash(), type.getName(), type.getQualifiedName())
      .withScopeLinkHash(classScopeHash)
      .withEndColumn(
        this.input.positions.byteColumn(classNode.endPosition.row, classNode.endPosition.column)
      )
      .build();
    this.methods.push(method);
    return method;
  }

  /**
   * Emits a `py_method` per `lambda`, in a dedicated pass.
   *
   * Lambdas need their own pass because they are **expressions**: they occur in
   * defaults, decorators, class bases, comprehensions and arbitrary nested
   * expressions, none of which the statement walk descends into. Schema §2.7
   * lists `lambda` alongside `def` and `async def`, and the entire reason
   * `startColumn` is in the `py_method` primary key is that
   * `g = (lambda: 1, lambda: 2)` produces two rows whose name, qualifiedName,
   * signature and startLine are all identical.
   *
   * Without these rows three things break, all silently: a LAMBDA scope's
   * `ownerHash` has nothing to point at, a call inside a lambda is attributed to
   * the enclosing function instead of the lambda, and `methodKind=LAMBDA` is
   * never emitted at all.
   *
   * The walk threads the enclosing type and method itself rather than reusing
   * the statement walk's context, because a lambda's owner is whatever
   * definition lexically encloses it — which for a lambda inside a nested def is
   * that def, and for a lambda in a decorator is the definition OUTSIDE the one
   * being decorated.
   */
  private emitLambdaMethods(
    node: Parser.SyntaxNode,
    enclosingTypeHash: string,
    enclosingMethodHash: string
  ): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }

      if (child.type === 'class_definition') {
        const body = child.childForFieldName('body');
        const typeHash = this.typeHashByNodeId.get(child.id) ?? enclosingTypeHash;
        const classInit = this.classInitHashByNodeId.get(child.id) ?? enclosingMethodHash;
        // Bases and decorators are evaluated OUTSIDE the class body, so a lambda
        // in them belongs to the enclosing owner, not to the class.
        for (let j = 0; j < child.namedChildCount; j++) {
          const part = child.namedChild(j);
          if (part && part.id !== body?.id) {
            this.emitLambdaMethods(part, enclosingTypeHash, enclosingMethodHash);
          }
        }
        if (body) {
          this.emitLambdaMethods(body, typeHash, classInit);
        }
        continue;
      }

      if (child.type === 'function_definition') {
        const body = child.childForFieldName('body');
        const methodHash = this.methodHashByNodeId.get(child.id) ?? enclosingMethodHash;
        // Same rule: defaults, annotations and decorators evaluate outside.
        for (let j = 0; j < child.namedChildCount; j++) {
          const part = child.namedChild(j);
          if (part && part.id !== body?.id) {
            this.emitLambdaMethods(part, enclosingTypeHash, enclosingMethodHash);
          }
        }
        if (body) {
          this.emitLambdaMethods(body, enclosingTypeHash, methodHash);
        }
        continue;
      }

      if (child.type === 'lambda') {
        const method = this.emitLambdaMethod(child, enclosingTypeHash, enclosingMethodHash);
        const parametersNode = child.childForFieldName('parameters');
        const bodyNode = child.childForFieldName('body');
        // A lambda's own defaults evaluate in the ENCLOSING scope, so a lambda
        // nested in a default belongs to the enclosing owner; only the body is
        // owned by this lambda.
        if (parametersNode) {
          this.emitLambdaMethods(parametersNode, enclosingTypeHash, enclosingMethodHash);
        }
        if (bodyNode) {
          this.emitLambdaMethods(bodyNode, enclosingTypeHash, method.getHash());
        }
        continue;
      }

      this.emitLambdaMethods(child, enclosingTypeHash, enclosingMethodHash);
    }
  }

  private emitLambdaMethod(
    node: Parser.SyntaxNode,
    enclosingTypeHash: string,
    enclosingMethodHash: string
  ): PyMethodRegistry {
    const parametersNode = node.childForFieldName('parameters');
    const parameters = this.collectParameters(parametersNode);
    const scopeHash = this.input.scopeHashByNodeId.get(node.id) ?? '';
    // CPython's __qualname__ for a lambda is `<lambda>`; the scope keeps
    // symtable's own name, `lambda`. Each column follows its own source of truth.
    const qualifiedName =
      (this.input.qualifiedNameByNodeId.get(node.id) ?? '').replace(/\.lambda$/, `.${PYTHON_LAMBDA_METHOD_NAME}`) ||
      PYTHON_LAMBDA_METHOD_NAME;
    const end = this.declarationEndPosition(node);

    const method = PyMethodRegistry.builder(
      PYTHON_LAMBDA_METHOD_NAME,
      this.buildSignature(PYTHON_LAMBDA_METHOD_NAME, parameters),
      qualifiedName,
      this.input.filePath,
      node.startPosition.row + 1,
      end.row + 1,
      this.input.positions.byteColumn(node.startPosition.row, node.startPosition.column),
      this.input.module.getHash(),
      this.input.serviceVersionLinkHash
    )
      .withDetailedSignature(this.buildDetailedSignature(PYTHON_LAMBDA_METHOD_NAME, parameters, null))
      .withKindAndAccess(PythonMethodKind.LAMBDA, PythonMethodAccess.PUBLIC_ACCESS)
      .withParameterShape({
        parameterCount: parameters.filter(p => p.name !== '').length,
        posOnlyCount: parameters.filter(p => p.kind === PythonParameterKind.POSITIONAL_ONLY).length,
        kwOnlyCount: parameters.filter(p => p.kind === PythonParameterKind.KEYWORD_ONLY).length,
        isVarArgs: parameters.some(p => p.kind === PythonParameterKind.VAR_POSITIONAL),
        hasKwArgs: parameters.some(p => p.kind === PythonParameterKind.VAR_KEYWORD),
        // A lambda never has a receiver: it is not bound as a method even when
        // it is assigned to a class attribute.
        hasReceiverParameter: false,
      })
      .withScopeLinkHash(scopeHash)
      .withEnclosingMemberLinkHash(enclosingMethodHash)
      .withEndColumn(this.input.positions.byteColumn(end.row, end.column))
      .build();

    if (enclosingTypeHash !== '') {
      // The owning class, when the lambda sits inside a class body.
      method.setDeclaringBindingLinkHash('');
    }
    this.methods.push(method);
    this.lambdaMethodByNodeId.set(node.id, method.getHash());
    this.scopeOwnerByNodeId.set(node.id, method.getHash());
    this.enclosingMethodByScopeNodeId.set(node.id, method.getHash());
    this.emitLambdaParameters(parameters, method, scopeHash);
    return method;
  }

  private emitLambdaParameters(
    parameters: ParameterEntry[],
    method: PyMethodRegistry,
    scopeHash: string
  ): void {
    for (const parameter of parameters) {
      const builder = PyMethodParameterRegistry.builder(
        parameter.name,
        parameter.position,
        method.getHash(),
        parameter.kind,
        parameter.node.startPosition.row + 1,
        parameter.node.endPosition.row + 1,
        this.input.serviceVersionLinkHash
      ).withBindingLinkHash(
        this.input.bindingHashByScopeAndName.get(`${scopeHash}::${parameter.name}`) ?? ''
      );
      if (parameter.defaultNode) {
        builder.withDefault(
          EntityUtils.normalizeWhitespace(parameter.defaultNode.text),
          this.defaultValueKindOf(parameter.defaultNode)
        );
      }
      const row = builder.build();
      if (parameter.defaultNode) {
        const defaultNode = this.unwrapParentheses(parameter.defaultNode);
        this.parameterDefaultByteRange.set(
          row.getHash(),
          `${defaultNode.startIndex}:${defaultNode.endIndex}`
        );
      }
      // The annotation node's range, so the expression stage can make this
      // parameter the OWNER of its annotation subtree. That ownership is the
      // only route from a parameter row to the N types its annotation
      // references: the row has one potentialQualifiedName slot, which cannot
      // express `Dict[TypeA, TypeB]`.
      const annotationNode = parameter.node.childForFieldName('type');
      if (annotationNode) {
        this.parameterHashByAnnotationRange.set(
          `${annotationNode.startIndex}:${annotationNode.endIndex}`,
          row.getHash()
        );
        this.typePositions.push({
          node: annotationNode,
          context: PythonTypeRefContext.METHOD_PARAM,
          ownerHash: row.getHash(),
          ownerKind: PythonTypeRefOwnerKind.METHOD_PARAM,
          enclosingTypeHash: context.enclosingTypeHash,
          scopeHash,
        });
      }
      this.methodParameters.push(row);
    }
  }

  // ------------------------------------------------------------------ walk

  private visitBody(node: Parser.SyntaxNode, context: DeclarationContext): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        this.visitStatement(child, context);
      }
    }
  }

  private visitStatement(node: Parser.SyntaxNode, context: DeclarationContext): void {
    switch (node.type) {
      case 'decorated_definition': {
        const decorators: Parser.SyntaxNode[] = [];
        let definition: Parser.SyntaxNode | null = null;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (!child) {
            continue;
          }
          if (child.type === 'decorator') {
            decorators.push(child);
            continue;
          }
          definition = child;
        }
        if (definition?.type === 'class_definition') {
          this.visitClassDefinition(definition, context, decorators);
          return;
        }
        if (definition?.type === 'function_definition') {
          this.visitFunctionDefinition(definition, context, decorators);
          return;
        }
        if (definition) {
          this.visitStatement(definition, context);
        }
        return;
      }

      case 'class_definition': {
        this.visitClassDefinition(node, context, []);
        return;
      }

      case 'function_definition': {
        this.visitFunctionDefinition(node, context, []);
        return;
      }

      case 'import_statement':
      case 'import_from_statement':
      case 'future_import_statement': {
        this.visitImport(node, context);
        return;
      }

      case 'expression_statement': {
        // An annotated assignment is a type position too: `total: TypeC = None`.
        // Its owner is the BINDING the name creates, so the engine can go from a
        // variable to the types its declared type references.
        for (let i = 0; i < node.namedChildCount; i++) {
          const inner = node.namedChild(i);
          if (inner?.type !== 'assignment') {
            continue;
          }
          const target = inner.childForFieldName('left');
          const annotation = inner.childForFieldName('type');
          if (!annotation || target?.type !== 'identifier') {
            continue;
          }
          const bindingHash = this.input.bindingHashByScopeAndName.get(
            `${context.bindingScopeHash}::${target.text}`
          );
          if (!bindingHash) {
            continue;
          }
          this.typePositions.push({
            node: annotation,
            context: PythonTypeRefContext.VARIABLE_ANNOTATION,
            ownerHash: bindingHash,
            ownerKind: PythonTypeRefOwnerKind.BINDING,
            enclosingTypeHash: context.enclosingTypeHash,
            scopeHash: context.bindingScopeHash,
          });
        }
        this.visitBody(node, context);
        return;
      }

      case 'if_statement': {
        // An `if TYPE_CHECKING:` body does not exist at runtime, and everything
        // under a module-level `if` is conditional. Both facts are inherited by
        // every declaration nested inside.
        const condition = node.childForFieldName('condition');
        const isTypeChecking =
          condition !== null && /\bTYPE_CHECKING\b/.test(condition.text);
        const nested: DeclarationContext = {
          ...context,
          isConditional: true,
          isTypeCheckingOnly: context.isTypeCheckingOnly || isTypeChecking,
        };
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (!child || child.id === condition?.id) {
            continue;
          }
          this.visitStatement(child, nested);
        }
        return;
      }

      case 'try_statement':
      case 'while_statement':
      case 'for_statement':
      case 'with_statement':
      case 'match_statement': {
        const nested: DeclarationContext = { ...context, isConditional: true };
        this.visitBody(node, nested);
        return;
      }

      default: {
        this.visitBody(node, context);
        return;
      }
    }
  }

  // ----------------------------------------------------------------- types

  private visitClassDefinition(
    node: Parser.SyntaxNode,
    context: DeclarationContext,
    decorators: Parser.SyntaxNode[]
  ): void {
    const nameNode = node.childForFieldName('name');
    const bodyNode = node.childForFieldName('body');
    const argumentsNode = node.childForFieldName('superclasses');
    const className = nameNode?.text ?? '';
    const classScopeHash = this.input.scopeHashByNodeId.get(node.id) ?? '';
    const qualifiedName =
      this.input.qualifiedNameByNodeId.get(node.id) ??
      `${this.input.module.getQualifiedName()}.${className}`;

    const bases = this.collectBases(argumentsNode);
    const decoratorNames = decorators.map(d => this.decoratorDottedPath(d));
    const classEnd = this.declarationEndPosition(node);
    const declaresAbstractMember = bodyNode !== null && this.hasAbstractMember(bodyNode);

    const type = PyTypeRegistry.builder(
      className,
      qualifiedName,
      this.input.fileName,
      this.input.filePath,
      this.input.baseMservPath,
      node.startPosition.row + 1,
      classEnd.row + 1,
      this.input.module.getHash(),
      this.input.serviceVersionLinkHash
    )
      .withCategoryAndAccess(
        this.classifyType(bases, decoratorNames, declaresAbstractMember),
        this.accessOf(className) as unknown as PythonTypeAccess
      )
      .withModifiers(this.typeModifiersOf(bases, decoratorNames, bodyNode))
      .withPlacement(this.placementOf(context))
      .withEnclosing(context.enclosingTypeHash, context.inFunctionBody ? context.enclosingMethodHash : '')
      .withScopeLinkHash(classScopeHash)
      .withBases(
        bases.filter(b => b.keywordName === '').length,
        bases.some(b => b.isDynamic),
        this.mroKindOf(bases),
        bases.find(b => b.keywordName === 'metaclass')?.baseText ?? ''
      )
      .withDocstring(this.docstringOf(bodyNode))
      .build();

    this.types.push(type);
    this.typeHashByNodeId.set(node.id, type.getHash());
    this.scopeOwnerByNodeId.set(node.id, type.getHash());
    type.setDeclaringBindingLinkHash(
      this.input.bindingHashByScopeAndName.get(
        `${context.bindingScopeHash}::${className}`
      ) ?? ''
    );

    this.emitBases(bases, type);

    const classInit = this.emitClassInitializer(node, type, classScopeHash);
    type.setClassInitMethodLinkHash(classInit.getHash());
    this.classInitHashByNodeId.set(node.id, classInit.getHash());
    // Class-body bindings belong to the synthetic <classbody> method.
    this.enclosingMethodByScopeNodeId.set(node.id, classInit.getHash());

    if (!bodyNode) {
      return;
    }
    this.visitBody(bodyNode, {
      ...context,
      enclosingTypeHash: type.getHash(),
      enclosingTypeName: className,
      enclosingTypeQualifiedName: qualifiedName,
      enclosingMethodHash: classInit.getHash(),
      bindingScopeHash: classScopeHash,
      inClassBody: true,
      inFunctionBody: false,
    });
  }

  /**
   * Refines `typeCategory` by following base classes **within this module**.
   *
   * A category is often stated one hop away rather than on the class itself:
   *
   * ```python
   * class MessageDefect(ValueError): ...          # EXCEPTION_CLASS_TYPE, by name
   * class NoBoundaryDefect(MessageDefect): ...    # also an exception, but the
   *                                               # base name matches no pattern
   * ```
   *
   * Resolving that is squarely parser work: §0.5 puts intra-module resolution in
   * layer 3, on the grounds that it is decidable within one module. What is NOT
   * attempted is the cross-module case — `class BrokenProcessPool(_base.BrokenExecutor)`
   * stays `CLASS_TYPE`, because the base is not in this module and guessing would
   * be exactly the confident-wrong-answer this schema is organised against. The
   * engine refines those.
   *
   * Also not attempted: a base bound by an assignment to a call result, as in
   * `_Instruction = collections.namedtuple(...)` followed by
   * `class Instruction(_Instruction)`. That is constructor-call inference, which
   * the schema assigns to the deferred `py_type_inference` relation.
   *
   * Iterated to a fixed point so a chain of any depth resolves, bounded by the
   * number of types as a guard against a cyclic base list in malformed source.
   */
  private propagateCategoriesThroughLocalBases(): void {
    // Categories a subclass genuinely inherits. Three are deliberately absent,
    // and each exclusion is a real distinction rather than caution:
    //
    //  - ABC_TYPE: abstractness is NOT inherited. It depends on whether abstract
    //    methods remain unimplemented, which is per-class —
    //    `class closing(AbstractContextManager)` descends from an ABC and is
    //    perfectly concrete, and CPython's inspect.isabstract agrees. An earlier
    //    version of this pass inherited it and mislabelled nine concrete
    //    contextlib classes.
    //  - PROTOCOL_TYPE: subclassing a Protocol produces an implementation of it,
    //    not another Protocol.
    //  - DATACLASS_TYPE: @dataclass decorates one class; a subclass is not a
    //    dataclass unless it is itself decorated.
    const inheritable = new Set<PythonTypeCategory>([
      PythonTypeCategory.EXCEPTION_CLASS_TYPE,
      PythonTypeCategory.ENUM_CLASS_TYPE,
      PythonTypeCategory.NAMEDTUPLE_TYPE,
      PythonTypeCategory.TYPEDDICT_TYPE,
      PythonTypeCategory.METACLASS_TYPE,
    ]);

    const typeByName = new Map<string, PyTypeRegistry>();
    for (const type of this.types) {
      // Last definition wins, matching runtime rebinding semantics.
      typeByName.set(type.getName(), type);
    }
    const baseNamesByTypeHash = new Map<string, string[]>();
    for (const base of this.typeBases) {
      if (base.getKeywordName() !== '' || base.getBaseSimpleName() === '') {
        continue;
      }
      const existing = baseNamesByTypeHash.get(base.getPyTypeLinkHash()) ?? [];
      existing.push(base.getBaseSimpleName());
      baseNamesByTypeHash.set(base.getPyTypeLinkHash(), existing);
    }

    for (let pass = 0; pass < this.types.length; pass++) {
      let changed = false;
      for (const type of this.types) {
        if (type.getTypeCategory() !== PythonTypeCategory.CLASS_TYPE) {
          continue;
        }
        for (const baseName of baseNamesByTypeHash.get(type.getHash()) ?? []) {
          const base = typeByName.get(baseName);
          if (!base || base.getHash() === type.getHash()) {
            continue;
          }
          if (inheritable.has(base.getTypeCategory())) {
            type.setTypeCategory(base.getTypeCategory());
            changed = true;
            break;
          }
        }
      }
      if (!changed) {
        break;
      }
    }
  }

  /**
   * Collects the base list, keeping positional and keyword entries distinct.
   *
   * `metaclass=` and `total=` sit in the same syntactic list as real bases but
   * are not bases, so they get rows with an empty `position` and never advance
   * the MRO index.
   */
  private collectBases(argumentsNode: Parser.SyntaxNode | null): BaseEntry[] {
    if (!argumentsNode) {
      return [];
    }
    const entries: BaseEntry[] = [];
    let position = 0;

    for (let i = 0; i < argumentsNode.namedChildCount; i++) {
      const child = argumentsNode.namedChild(i);
      // Grammar extras are NAMED nodes, so a comment inside a base list was
      // becoming a base — and worse, taking an MRO POSITION. `class C(A,  #
      // comment\n B)` put the comment at position 1 and pushed B to 2, which
      // silently corrupts C3 linearisation for any class written that way.
      // Third site of this root cause, after argument lists and parameter lists.
      if (!child || child.isExtra) {
        continue;
      }

      if (child.type === 'keyword_argument') {
        const keyword = child.childForFieldName('name')?.text ?? '';
        const value = child.childForFieldName('value');
        entries.push({
          node: value ?? child,
          baseKind:
            keyword === 'metaclass'
              ? PythonBaseKind.KEYWORD_METACLASS
              : PythonBaseKind.KEYWORD_OTHER,
          position: null,
          keywordName: keyword,
          baseText: EntityUtils.normalizeWhitespace(value?.text ?? ''),
          isDynamic: false,
        });
        continue;
      }

      const kind = this.baseKindOf(child);
      entries.push({
        node: child,
        baseKind: kind,
        position: position++,
        keywordName: '',
        baseText: EntityUtils.normalizeWhitespace(child.text),
        isDynamic: kind === PythonBaseKind.CALL || kind === PythonBaseKind.STARRED,
      });
    }
    return entries;
  }

  private emitBases(bases: BaseEntry[], type: PyTypeRegistry): void {
    for (const base of bases) {
      const builder = PyTypeBaseRegistry.builder(
        base.baseKind,
        base.baseText,
        type.getHash(),
        this.input.module.getHash(),
        base.node.startPosition.row + 1,
        this.input.serviceVersionLinkHash
      )
        .withKeywordName(base.keywordName)
        .withIsDynamic(base.isDynamic)
        .withNameParts(this.baseSimpleNameOf(base), this.dottedPathOf(base.node));

      if (base.position !== null) {
        builder.withPosition(base.position);
      }
      const row = builder.build();
      this.typeBases.push(row);
      // A positional base and `metaclass=` name TYPES. Any other keyword —
      // `total=False` on a TypedDict — is a value, so it gets no type reference
      // and correspondingly no twin link.
      if (base.keywordName === '' || base.keywordName === 'metaclass') {
        this.typePositions.push({
          node: base.node,
          context:
            base.keywordName === 'metaclass'
              ? PythonTypeRefContext.METACLASS
              : PythonTypeRefContext.BASE_CLASS,
          ownerHash: row.getHash(),
          ownerKind: PythonTypeRefOwnerKind.TYPE_BASE,
          enclosingTypeHash: type.getHash(),
          scopeHash: '',
        });
      }
    }
  }

  /**
   * `baseSimpleName` for a base, or `''` when the base is not name-shaped.
   *
   * §2.5 c3 says "rightmost identifier — `Mapping`; `\"\"` if not name-shaped",
   * and a computed base is not name-shaped:
   *
   * ```python
   * class _Method(_namedtuple('_Method', 'name ident')): ...   # CALL
   * class _swapped_meta(type(Structure)): ...                  # CALL
   * ```
   *
   * Returning the CALLEE's name for those would claim the class inherits from
   * `_namedtuple` or `type`, when it inherits from whatever the call returned.
   * The text is not lost — `baseText` keeps `_namedtuple('_Method', …)` verbatim
   * and `isDynamic` marks it — but the NAME slot has to stay empty, or a
   * name→type resolver will resolve it to the wrong thing.
   */
  private baseSimpleNameOf(base: BaseEntry): string {
    switch (base.baseKind) {
      case PythonBaseKind.CALL:
      case PythonBaseKind.STARRED: {
        return '';
      }
      default: {
        return this.rightmostName(base.node);
      }
    }
  }

  private baseKindOf(node: Parser.SyntaxNode): PythonBaseKind {
    switch (node.type) {
      case 'identifier': {
        return PythonBaseKind.NAME;
      }
      case 'attribute': {
        return PythonBaseKind.DOTTED_NAME;
      }
      case 'subscript':
      case 'generic_type': {
        return PythonBaseKind.SUBSCRIPT;
      }
      case 'call': {
        return PythonBaseKind.CALL;
      }
      case 'list_splat': {
        return PythonBaseKind.STARRED;
      }
      default: {
        return PythonBaseKind.NAME;
      }
    }
  }

  /**
   * Distinguishes a trivial MRO from a real C3 linearisation from one that
   * cannot be linearised at all.
   *
   * 19.5% of classes have no explicit base and 12.1% have more than one, so all
   * four answers occur often enough to matter.
   */
  private mroKindOf(bases: BaseEntry[]): PythonMroKind {
    const positional = bases.filter(b => b.keywordName === '');
    if (positional.some(b => b.isDynamic)) {
      return PythonMroKind.DYNAMIC_UNKNOWN;
    }
    if (positional.length === 0) {
      return PythonMroKind.IMPLICIT_OBJECT;
    }
    if (positional.length === 1) {
      return PythonMroKind.SINGLE_INHERITANCE;
    }
    return PythonMroKind.C3_LINEARIZABLE;
  }

  /**
   * The rightmost name of the `metaclass=` keyword argument, or `''`.
   *
   * Extracted separately because a metaclass is a **classification signal** even
   * though it is not a base. `class C(metaclass=ABCMeta)` and `class C(ABC)` are
   * the same thing to a reader and to `isinstance`, but only the second is a
   * positional base — so filtering keyword entries out before classifying makes
   * the first invisible.
   */
  private metaclassSimpleName(bases: BaseEntry[]): string {
    const metaclass = bases.find(b => b.keywordName === 'metaclass');
    if (!metaclass) {
      return '';
    }
    // Handles both `metaclass=ABCMeta` and `metaclass=abc.ABCMeta`.
    return this.rightmostName(metaclass.node) || metaclass.baseText.split('.').pop() || '';
  }

  /**
   * Classifies a class.
   *
   * **Keyword bases are inspected, not discarded.** The `metaclass=` idiom is
   * ordinary Python, not a curiosity: `metaclass=ABCMeta` predates the `ABC`
   * convenience base and is still required when a class needs an unrelated
   * metaclass mixed in, and `metaclass=EnumMeta` is how you write an Enum-like
   * class that needs behaviour `Enum.__new__` does not provide. Dropping keyword
   * entries before the name checks made every such class a plain `CLASS_TYPE`,
   * and in the ABCMeta case produced an internally inconsistent row —
   * `typeModifier=ABSTRACT` alongside `typeCategory=CLASS_TYPE` — because the
   * modifier pass did not filter them and this one did.
   */
  private classifyType(
    bases: BaseEntry[],
    decoratorNames: string[],
    declaresAbstractMember: boolean
  ): PythonTypeCategory {
    const baseNames = bases
      .filter(b => b.keywordName === '')
      .map(b => this.rightmostName(b.node));
    const metaclass = this.metaclassSimpleName(bases);

    if (decoratorNames.some(d => d.endsWith('dataclass'))) {
      return PythonTypeCategory.DATACLASS_TYPE;
    }
    // A metaclass names the kind of class this IS, so it is checked with the
    // same equality tests applied to positional bases.
    if (metaclass === 'ABCMeta') {
      return PythonTypeCategory.ABC_TYPE;
    }
    if (metaclass === 'EnumMeta' || metaclass === 'EnumType') {
      return PythonTypeCategory.ENUM_CLASS_TYPE;
    }
    if (baseNames.some(n => n === 'Protocol')) {
      return PythonTypeCategory.PROTOCOL_TYPE;
    }
    if (baseNames.some(n => n === 'TypedDict')) {
      return PythonTypeCategory.TYPEDDICT_TYPE;
    }
    if (baseNames.some(n => n === 'NamedTuple' || n === 'namedtuple')) {
      return PythonTypeCategory.NAMEDTUPLE_TYPE;
    }
    if (baseNames.some(n => /^(Enum|IntEnum|StrEnum|Flag|IntFlag)$/.test(n))) {
      return PythonTypeCategory.ENUM_CLASS_TYPE;
    }
    if (baseNames.some(n => n === 'type')) {
      return PythonTypeCategory.METACLASS_TYPE;
    }
    if (baseNames.some(n => n === 'ABC') || baseNames.some(n => n === 'ABCMeta')) {
      return PythonTypeCategory.ABC_TYPE;
    }
    // A class that declares @abstractmethod members IS an abstract base, even
    // when it inherits ABCMeta through a base rather than naming it. Without
    // this the row is self-contradictory — typeCategory=CLASS_TYPE alongside an
    // ABSTRACT modifier — which is what `numbers.Complex`, `Real`, `Rational`
    // and `Integral` all produced. Purely syntactic: the decorators are right
    // there in the class body, so no cross-module knowledge is needed.
    if (declaresAbstractMember) {
      return PythonTypeCategory.ABC_TYPE;
    }
    if (baseNames.some(n => /(Error|Exception|Warning)$/.test(n))) {
      return PythonTypeCategory.EXCEPTION_CLASS_TYPE;
    }
    if (baseNames.some(n => n === 'Generic')) {
      return PythonTypeCategory.GENERIC_TYPE;
    }
    return PythonTypeCategory.CLASS_TYPE;
  }

  private typeModifiersOf(
    bases: BaseEntry[],
    decoratorNames: string[],
    bodyNode: Parser.SyntaxNode | null
  ): PythonTypeModifier[] {
    const modifiers: PythonTypeModifier[] = [];
    // Positional bases and the metaclass are considered separately, so the two
    // classification passes cannot disagree about whether a keyword entry
    // counts — which is exactly the inconsistency this replaced.
    const baseNames = bases
      .filter(b => b.keywordName === '')
      .map(b => this.rightmostName(b.node));
    const metaclass = this.metaclassSimpleName(bases);

    if (decoratorNames.some(d => d.endsWith('final'))) {
      modifiers.push(PythonTypeModifier.FINAL);
    }
    if (decoratorNames.some(d => d.includes('dataclass')) && /frozen\s*=\s*True/.test(
      bases.map(b => b.baseText).join(' ')
    )) {
      modifiers.push(PythonTypeModifier.FROZEN);
    }
    if (decoratorNames.some(d => d.endsWith('runtime_checkable'))) {
      modifiers.push(PythonTypeModifier.RUNTIME_CHECKABLE);
    }
    if (baseNames.some(n => n === 'ABC' || n === 'ABCMeta') || metaclass === 'ABCMeta') {
      modifiers.push(PythonTypeModifier.ABSTRACT);
    }
    if (baseNames.some(n => n === 'Generic' || n === 'Protocol')) {
      modifiers.push(PythonTypeModifier.GENERIC);
    }

    if (bodyNode) {
      const members = this.classBodyMemberNames(bodyNode);
      if (members.has('__slots__')) {
        modifiers.push(PythonTypeModifier.SLOTS);
      }
      // The dispatch escape hatches: a class answering for names that appear
      // nowhere in the source means "attribute not found" is not a safe
      // conclusion about it.
      if (members.has('__getattr__') || members.has('__getattribute__')) {
        modifiers.push(PythonTypeModifier.HAS_GETATTR);
      }
      if (members.has('__setattr__')) {
        modifiers.push(PythonTypeModifier.HAS_SETATTR);
      }
      if (members.has('__call__')) {
        // HAS_CALL only. `CALLABLE_INSTANCE` is not emitted: a class defines
        // `__call__` if and only if its instances are callable, so as the schema
        // defines them today the two are COEXTENSIVE and emitting both puts the
        // same fact in the row twice under two names. A consumer counting
        // modifiers would double-count, and a rule keying on one would silently
        // depend on which name happened to be written.
        //
        // The oracle emits HAS_CALL alone, so emitting both also showed as a
        // disagreement — the correct outcome for a field with no agreed meaning.
        // A0 has the schema call open (remove the value, or redefine the pair as
        // declared-here versus callable-including-inherited, both of which are
        // detectable). Until that lands, emitting the one value that is defined
        // is the honest option, and the alternative — inventing a distinction to
        // justify keeping both — is the thing to avoid.
        modifiers.push(PythonTypeModifier.HAS_CALL);
      }
      if (this.hasAbstractMember(bodyNode)) {
        modifiers.push(PythonTypeModifier.ABSTRACT);
      }
    }
    return Array.from(new Set(modifiers));
  }

  private classBodyMemberNames(bodyNode: Parser.SyntaxNode): Set<string> {
    const names = new Set<string>();
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const statement = bodyNode.namedChild(i);
      if (!statement) {
        continue;
      }
      const definition =
        statement.type === 'decorated_definition'
          ? statement.namedChild(statement.namedChildCount - 1)
          : statement;
      if (definition?.type === 'function_definition') {
        const name = definition.childForFieldName('name')?.text;
        if (name) {
          names.add(name);
        }
        continue;
      }
      if (statement.type === 'expression_statement') {
        const assignment = statement.namedChild(0);
        if (assignment?.type === 'assignment') {
          const left = assignment.childForFieldName('left');
          if (left?.type === 'identifier') {
            names.add(left.text);
          }
        }
      }
    }
    return names;
  }

  private hasAbstractMember(bodyNode: Parser.SyntaxNode): boolean {
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const statement = bodyNode.namedChild(i);
      if (statement?.type !== 'decorated_definition') {
        continue;
      }
      for (let j = 0; j < statement.namedChildCount; j++) {
        const decorator = statement.namedChild(j);
        if (decorator?.type === 'decorator' && /abstract/.test(decorator.text)) {
          return true;
        }
      }
    }
    return false;
  }

  private placementOf(context: DeclarationContext): PythonTypePlacement {
    if (context.isTypeCheckingOnly) {
      return PythonTypePlacement.TYPE_CHECKING_PLACEMENT;
    }
    if (context.inFunctionBody) {
      return PythonTypePlacement.LOCAL_PLACEMENT;
    }
    if (context.inClassBody) {
      return PythonTypePlacement.NESTED_PLACEMENT;
    }
    if (context.isConditional) {
      return PythonTypePlacement.CONDITIONAL_PLACEMENT;
    }
    return PythonTypePlacement.TOP_LEVEL_PLACEMENT;
  }

  // --------------------------------------------------------------- methods

  private visitFunctionDefinition(
    node: Parser.SyntaxNode,
    context: DeclarationContext,
    decorators: Parser.SyntaxNode[]
  ): void {
    const nameNode = node.childForFieldName('name');
    const parametersNode = node.childForFieldName('parameters');
    const returnTypeNode = node.childForFieldName('return_type');
    const bodyNode = node.childForFieldName('body');
    const functionName = nameNode?.text ?? '';
    const scopeHash = this.input.scopeHashByNodeId.get(node.id) ?? '';
    const qualifiedName =
      this.input.qualifiedNameByNodeId.get(node.id) ??
      `${this.input.module.getQualifiedName()}.${functionName}`;

    const parameters = this.collectParameters(parametersNode);
    const decoratorNames = decorators.map(d => this.decoratorDottedPath(d));
    const isAsync = this.hasAsyncPrefix(node);
    const isGenerator = bodyNode !== null && this.containsYield(bodyNode);
    const methodEnd = this.declarationEndPosition(node);

    const method = PyMethodRegistry.builder(
      functionName,
      this.buildSignature(functionName, parameters),
      qualifiedName,
      this.input.filePath,
      node.startPosition.row + 1,
      methodEnd.row + 1,
      this.input.positions.byteColumn(node.startPosition.row, node.startPosition.column),
      this.input.module.getHash(),
      this.input.serviceVersionLinkHash
    )
      .withDetailedSignature(this.buildDetailedSignature(functionName, parameters, returnTypeNode))
      .withOwner(
        context.enclosingTypeHash,
        context.enclosingTypeName,
        context.enclosingTypeQualifiedName
      )
      .withKindAndAccess(
        this.methodKindOf(functionName, decoratorNames, context, isAsync, isGenerator),
        this.methodAccessOf(functionName)
      )
      .withModifiers(this.methodModifiersOf(decoratorNames, isAsync, isGenerator, functionName))
      .withReturnTypeName(returnTypeNode ? this.normalizeTypeText(returnTypeNode.text) : '')
      .withParameterShape({
        parameterCount: parameters.filter(p => p.name !== '').length,
        posOnlyCount: parameters.filter(p => p.kind === PythonParameterKind.POSITIONAL_ONLY).length,
        kwOnlyCount: parameters.filter(p => p.kind === PythonParameterKind.KEYWORD_ONLY).length,
        isVarArgs: parameters.some(p => p.kind === PythonParameterKind.VAR_POSITIONAL),
        hasKwArgs: parameters.some(p => p.kind === PythonParameterKind.VAR_KEYWORD),
        hasReceiverParameter: this.hasReceiver(parameters, context, decoratorNames, functionName),
      })
      .withBodyFlags({
        isAsync,
        isGenerator,
        bodyIsStub: bodyNode !== null && this.bodyIsStub(bodyNode),
        decoratorCount: decorators.length,
      })
      .withThrowsExceptions(bodyNode ? this.collectRaisedTypeNames(bodyNode) : [])
      .withScopeLinkHash(scopeHash)
      .withEnclosingMemberLinkHash(context.inFunctionBody ? context.enclosingMethodHash : '')
      .withEndColumn(this.input.positions.byteColumn(methodEnd.row, methodEnd.column))
      .build();

    this.methods.push(method);
    this.methodHashByNodeId.set(node.id, method.getHash());
    if (returnTypeNode) {
      // The one type position that has NO home on the spine: py_method carries
      // returnTypeName as text with no resolved counterpart, so without this the
      // return type is reachable only through the expression tree.
      this.typePositions.push({
        node: returnTypeNode,
        context: PythonTypeRefContext.METHOD_RETURN,
        ownerHash: method.getHash(),
        ownerKind: PythonTypeRefOwnerKind.METHOD,
        enclosingTypeHash: context.enclosingTypeHash,
        scopeHash,
      });
    }
    this.scopeOwnerByNodeId.set(node.id, method.getHash());
    this.enclosingMethodByScopeNodeId.set(node.id, method.getHash());
    method.setDeclaringBindingLinkHash(
      this.input.bindingHashByScopeAndName.get(
        `${context.bindingScopeHash}::${functionName}`
      ) ?? ''
    );

    this.emitParameters(parameters, method, scopeHash, context, decoratorNames);

    if (!bodyNode) {
      return;
    }
    this.visitBody(bodyNode, {
      ...context,
      enclosingMethodHash: method.getHash(),
      bindingScopeHash: scopeHash,
      inClassBody: false,
      inFunctionBody: true,
    });
  }

  /**
   * Collects parameters in order, including the bare `/` and `*` markers.
   *
   * The markers get rows with an empty name because they occupy a position and
   * change the meaning of every parameter after them — dropping them would make
   * a positional-only signature indistinguishable from a normal one.
   */
  private collectParameters(parametersNode: Parser.SyntaxNode | null): ParameterEntry[] {
    if (!parametersNode) {
      return [];
    }
    const entries: ParameterEntry[] = [];
    let seenKeywordSeparator = false;
    let position = 0;

    for (let i = 0; i < parametersNode.namedChildCount; i++) {
      const param = parametersNode.namedChild(i);
      // Grammar extras — a comment or line continuation inside the parameter
      // list — are NAMED nodes. Counting them as parameters inflates
      // kwOnlyCount, which aiohttp's `debug: Any = ...,  # comment` exposes.
      if (!param || param.isExtra) {
        continue;
      }

      if (param.type === 'positional_separator') {
        entries.push(this.markerEntry(param, PythonParameterKind.POSITIONAL_ONLY_MARKER, position++));
        // Everything BEFORE `/` is retroactively positional-only.
        for (const earlier of entries) {
          if (earlier.kind === PythonParameterKind.POSITIONAL_OR_KEYWORD) {
            earlier.kind = PythonParameterKind.POSITIONAL_ONLY;
          }
        }
        continue;
      }

      if (param.type === 'keyword_separator') {
        seenKeywordSeparator = true;
        entries.push(this.markerEntry(param, PythonParameterKind.KEYWORD_ONLY_MARKER, position++));
        continue;
      }

      const splat = this.splatKindOf(param);
      if (splat === 'list') {
        seenKeywordSeparator = true;
      }

      const kind =
        splat === 'list'
          ? PythonParameterKind.VAR_POSITIONAL
          : splat === 'dictionary'
            ? PythonParameterKind.VAR_KEYWORD
            : seenKeywordSeparator
              ? PythonParameterKind.KEYWORD_ONLY
              : PythonParameterKind.POSITIONAL_OR_KEYWORD;

      const nameNode = this.parameterNameNode(param);
      const typeNode = param.childForFieldName('type');
      const valueNode = param.childForFieldName('value');

      entries.push({
        node: param,
        name: nameNode?.text ?? '',
        kind,
        position: position++,
        annotation: typeNode ? this.normalizeTypeText(typeNode.text) : '',
        annotationIsString: typeNode?.namedChild(0)?.type === 'string',
        defaultNode: valueNode ?? null,
      });
    }

    return entries;
  }

  private markerEntry(
    node: Parser.SyntaxNode,
    kind: PythonParameterKind,
    position: number
  ): ParameterEntry {
    return {
      node,
      name: '',
      kind,
      position,
      annotation: '',
      annotationIsString: false,
      defaultNode: null,
    };
  }

  private parameterNameNode(param: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (param.type === 'identifier') {
      return param;
    }
    const direct = param.childForFieldName('name') ?? param.namedChild(0);
    if (direct?.type === 'identifier') {
      return direct;
    }
    // An annotated splat nests one level deeper than a bare one.
    if (direct?.type === 'list_splat_pattern' || direct?.type === 'dictionary_splat_pattern') {
      const inner = direct.namedChild(0);
      return inner?.type === 'identifier' ? inner : null;
    }
    return null;
  }

  private splatKindOf(param: Parser.SyntaxNode): 'list' | 'dictionary' | null {
    if (param.type === 'list_splat_pattern') {
      return 'list';
    }
    if (param.type === 'dictionary_splat_pattern') {
      return 'dictionary';
    }
    for (let i = 0; i < param.namedChildCount; i++) {
      const child = param.namedChild(i);
      if (child?.type === 'list_splat_pattern') {
        return 'list';
      }
      if (child?.type === 'dictionary_splat_pattern') {
        return 'dictionary';
      }
    }
    return null;
  }

  private emitParameters(
    parameters: ParameterEntry[],
    method: PyMethodRegistry,
    scopeHash: string,
    context: DeclarationContext,
    decoratorNames: string[]
  ): void {
    const receiverIndex = this.receiverIndexOf(parameters, context, decoratorNames, method.getName());

    for (const parameter of parameters) {
      const builder = PyMethodParameterRegistry.builder(
        parameter.name,
        parameter.position,
        method.getHash(),
        parameter.kind,
        parameter.node.startPosition.row + 1,
        parameter.node.endPosition.row + 1,
        this.input.serviceVersionLinkHash
      )
        .withAnnotation(
          parameter.annotation,
          this.annotationBaseType(parameter.annotation),
          parameter.annotationIsString
        )
        .withIsReceiverParameter(parameter.position === receiverIndex)
        .withBindingLinkHash(
          this.input.bindingHashByScopeAndName.get(`${scopeHash}::${parameter.name}`) ?? ''
        );

      if (parameter.defaultNode) {
        builder.withDefault(
          EntityUtils.normalizeWhitespace(parameter.defaultNode.text),
          this.defaultValueKindOf(parameter.defaultNode)
        );
      }
      const row = builder.build();
      if (parameter.defaultNode) {
        // Unwrap parentheses before recording the range. The expression stage
        // treats a parenthesized_expression as transparent and emits a row for
        // the expression INSIDE it, so recording the outer node's range here
        // would make the two stages describe different nodes and the join would
        // silently find nothing — as it did for `def f(seed=(computed := 42))`.
        const defaultNode = this.unwrapParentheses(parameter.defaultNode);
        this.parameterDefaultByteRange.set(
          row.getHash(),
          `${defaultNode.startIndex}:${defaultNode.endIndex}`
        );
      }
      // The annotation node's range, so the expression stage can make this
      // parameter the OWNER of its annotation subtree. That ownership is the
      // only route from a parameter row to the N types its annotation
      // references: the row has one potentialQualifiedName slot, which cannot
      // express `Dict[TypeA, TypeB]`.
      const annotationNode = parameter.node.childForFieldName('type');
      if (annotationNode) {
        this.parameterHashByAnnotationRange.set(
          `${annotationNode.startIndex}:${annotationNode.endIndex}`,
          row.getHash()
        );
        this.typePositions.push({
          node: annotationNode,
          context: PythonTypeRefContext.METHOD_PARAM,
          ownerHash: row.getHash(),
          ownerKind: PythonTypeRefOwnerKind.METHOD_PARAM,
          enclosingTypeHash: context.enclosingTypeHash,
          scopeHash,
        });
      }
      this.methodParameters.push(row);
    }
  }

  /**
   * Which parameter is the receiver, or -1 for none.
   *
   * A `@staticmethod` has no receiver, so **every** positional argument shifts
   * by one relative to an instance method. Getting this wrong misaligns
   * argument→parameter flow for the whole signature.
   */
  private receiverIndexOf(
    parameters: ParameterEntry[],
    context: DeclarationContext,
    decoratorNames: string[],
    methodName: string
  ): number {
    if (!context.inClassBody) {
      return -1;
    }
    if (decoratorNames.some(d => d.endsWith('staticmethod'))) {
      return -1;
    }
    // `__new__` is an implicit staticmethod, but its first parameter IS the
    // class, so it still has a receiver — unlike a written @staticmethod.
    void methodName;
    const first = parameters[0];
    if (!first || first.name === '') {
      return -1;
    }
    if (
      first.kind !== PythonParameterKind.POSITIONAL_OR_KEYWORD &&
      first.kind !== PythonParameterKind.POSITIONAL_ONLY
    ) {
      return -1;
    }
    return first.position;
  }

  private hasReceiver(
    parameters: ParameterEntry[],
    context: DeclarationContext,
    decoratorNames: string[],
    methodName: string
  ): boolean {
    return this.receiverIndexOf(parameters, context, decoratorNames, methodName) >= 0;
  }

  /** Strips redundant parentheses, which carry no expression of their own. */
  private unwrapParentheses(node: Parser.SyntaxNode): Parser.SyntaxNode {
    let current = node;
    while (current.type === 'parenthesized_expression') {
      const inner = current.namedChild(0);
      if (!inner) {
        return current;
      }
      current = inner;
    }
    return current;
  }

  private defaultValueKindOf(node: Parser.SyntaxNode): PythonDefaultValueKind {
    switch (node.type) {
      case 'none': {
        return PythonDefaultValueKind.NONE_LITERAL;
      }
      case 'true':
      case 'false': {
        return PythonDefaultValueKind.BOOL;
      }
      case 'string':
      case 'concatenated_string': {
        return PythonDefaultValueKind.STRING;
      }
      case 'integer':
      case 'float': {
        return PythonDefaultValueKind.NUMBER;
      }
      case 'list': {
        return PythonDefaultValueKind.LIST;
      }
      case 'dictionary': {
        return PythonDefaultValueKind.DICT;
      }
      case 'set': {
        return PythonDefaultValueKind.SET;
      }
      case 'tuple': {
        return PythonDefaultValueKind.TUPLE;
      }
      case 'call': {
        return PythonDefaultValueKind.CALL;
      }
      case 'identifier':
      case 'attribute': {
        return PythonDefaultValueKind.NAME;
      }
      case 'lambda': {
        return PythonDefaultValueKind.LAMBDA;
      }
      case 'ellipsis': {
        return PythonDefaultValueKind.ELLIPSIS;
      }
      case 'unary_operator': {
        // A negative number literal is still a number.
        const operand = node.namedChild(0);
        if (operand?.type === 'integer' || operand?.type === 'float') {
          return PythonDefaultValueKind.NUMBER;
        }
        return PythonDefaultValueKind.UNKNOWN;
      }
      default: {
        return PythonDefaultValueKind.UNKNOWN;
      }
    }
  }

  private methodKindOf(
    name: string,
    decoratorNames: string[],
    context: DeclarationContext,
    isAsync: boolean,
    isGenerator: boolean
  ): PythonMethodKind {
    if (decoratorNames.some(d => d.endsWith('overload'))) {
      return PythonMethodKind.OVERLOAD_STUB;
    }
    // Python converts three dunders IMPLICITLY, with no decorator written:
    // `__new__` becomes a staticmethod, and `__init_subclass__` and
    // `__class_getitem__` become classmethods. That changes what argument 0 is,
    // so it shifts every positional argument→parameter link — the same hazard as
    // a missed @classmethod. `__new__` keeps the more specific ALLOCATOR, which
    // the schema designates for it.
    if (name === '__init_subclass__' || name === '__class_getitem__') {
      return PythonMethodKind.CLASS_METHOD;
    }
    if (decoratorNames.some(d => d.endsWith('staticmethod'))) {
      return PythonMethodKind.STATIC_METHOD;
    }
    if (decoratorNames.some(d => d.endsWith('classmethod'))) {
      return PythonMethodKind.CLASS_METHOD;
    }
    if (decoratorNames.some(d => d === 'property' || d.endsWith('.property'))) {
      return PythonMethodKind.PROPERTY_GETTER;
    }
    if (decoratorNames.some(d => d.endsWith('.setter'))) {
      return PythonMethodKind.PROPERTY_SETTER;
    }
    if (decoratorNames.some(d => d.endsWith('.deleter'))) {
      return PythonMethodKind.PROPERTY_DELETER;
    }
    if (decoratorNames.some(d => d.endsWith('abstractmethod'))) {
      return PythonMethodKind.ABSTRACT_METHOD;
    }
    if (name === '__init__') {
      return PythonMethodKind.CONSTRUCTOR;
    }
    if (name === '__new__') {
      return PythonMethodKind.ALLOCATOR;
    }
    if (isAsync && isGenerator) {
      return PythonMethodKind.ASYNC_GENERATOR;
    }
    if (isAsync) {
      return PythonMethodKind.ASYNC_FUNCTION;
    }
    if (isGenerator) {
      return PythonMethodKind.GENERATOR;
    }
    if (name.startsWith('__') && name.endsWith('__')) {
      return PythonMethodKind.DUNDER_METHOD;
    }
    if (context.inClassBody) {
      return PythonMethodKind.INSTANCE_METHOD;
    }
    if (context.inFunctionBody) {
      return PythonMethodKind.NESTED_FUNCTION;
    }
    return PythonMethodKind.FUNCTION;
  }

  private methodModifiersOf(
    decoratorNames: string[],
    isAsync: boolean,
    isGenerator: boolean,
    methodName: string
  ): PythonMethodModifier[] {
    const modifiers: PythonMethodModifier[] = [];
    // The implicit conversions Python applies without a decorator.
    if (methodName === '__init_subclass__' || methodName === '__class_getitem__') {
      modifiers.push(PythonMethodModifier.CLASS);
    }
    if (methodName === '__new__') {
      modifiers.push(PythonMethodModifier.STATIC);
    }
    if (isAsync) {
      modifiers.push(PythonMethodModifier.ASYNC);
    }
    if (isGenerator) {
      modifiers.push(PythonMethodModifier.GENERATOR);
    }
    for (const decorator of decoratorNames) {
      if (decorator.endsWith('staticmethod')) {
        modifiers.push(PythonMethodModifier.STATIC);
      }
      if (decorator.endsWith('classmethod')) {
        modifiers.push(PythonMethodModifier.CLASS);
      }
      if (decorator === 'property' || decorator.endsWith('.property')) {
        modifiers.push(PythonMethodModifier.PROPERTY);
      }
      if (decorator.endsWith('.setter')) {
        modifiers.push(PythonMethodModifier.SETTER);
      }
      if (decorator.endsWith('.deleter')) {
        modifiers.push(PythonMethodModifier.DELETER);
      }
      if (decorator.endsWith('abstractmethod')) {
        modifiers.push(PythonMethodModifier.ABSTRACT);
      }
      if (decorator.endsWith('overload')) {
        modifiers.push(PythonMethodModifier.OVERLOAD);
      }
      if (decorator.endsWith('final')) {
        modifiers.push(PythonMethodModifier.FINAL);
      }
      if (/(lru_cache|^cache$|cached_property)/.test(decorator)) {
        modifiers.push(PythonMethodModifier.CACHED);
      }
    }
    return Array.from(new Set(modifiers));
  }

  private methodAccessOf(name: string): PythonMethodAccess {
    if (name.startsWith('__') && name.endsWith('__')) {
      return PythonMethodAccess.DUNDER_ACCESS;
    }
    if (name.startsWith('__')) {
      return PythonMethodAccess.PRIVATE_ACCESS;
    }
    if (name.startsWith('_')) {
      return PythonMethodAccess.PROTECTED_ACCESS;
    }
    return PythonMethodAccess.PUBLIC_ACCESS;
  }

  private accessOf(name: string): PythonTypeAccess {
    if (name.startsWith('__')) {
      return PythonTypeAccess.PRIVATE_ACCESS;
    }
    if (name.startsWith('_')) {
      return PythonTypeAccess.PROTECTED_ACCESS;
    }
    return PythonTypeAccess.PUBLIC_ACCESS;
  }

  /**
   * Whether a body is only `...`, `pass`, or a docstring.
   *
   * These must never be call targets: `@overload` signatures (567 measured),
   * `Protocol` members and `.pyi` bodies all look like functions and implement
   * nothing.
   */
  private bodyIsStub(bodyNode: Parser.SyntaxNode): boolean {
    let meaningful = 0;
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const statement = bodyNode.namedChild(i);
      if (!statement) {
        continue;
      }
      if (statement.type === 'pass_statement') {
        continue;
      }
      if (statement.type === 'expression_statement') {
        const inner = statement.namedChild(0);
        if (inner?.type === 'string' || inner?.type === 'ellipsis') {
          continue;
        }
      }
      meaningful += 1;
    }
    return meaningful === 0;
  }

  /**
   * Type names appearing in `raise X` in this body.
   *
   * **Inferred, not declared** — Python has no `throws` clause. This is a lower
   * bound: it cannot see what a callee raises, and it stops at nested scope
   * boundaries so a nested function's raises are not attributed here.
   */
  private collectRaisedTypeNames(bodyNode: Parser.SyntaxNode): string[] {
    const names: string[] = [];
    const worklist: Parser.SyntaxNode[] = [bodyNode];
    while (worklist.length > 0) {
      const node = worklist.pop();
      if (!node) {
        continue;
      }
      if (node.type === 'raise_statement') {
        const target = node.namedChild(0);
        if (target) {
          const name = this.rightmostName(
            target.type === 'call' ? (target.childForFieldName('function') ?? target) : target
          );
          if (name) {
            names.push(name);
          }
        }
        continue;
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (
          child &&
          child.type !== 'function_definition' &&
          child.type !== 'class_definition' &&
          child.type !== 'decorated_definition'
        ) {
          worklist.push(child);
        }
      }
    }
    return Array.from(new Set(names)).sort();
  }

  private buildSignature(name: string, parameters: ParameterEntry[]): string {
    const parts = parameters.map(p => {
      if (p.kind === PythonParameterKind.POSITIONAL_ONLY_MARKER) {
        return '/';
      }
      if (p.kind === PythonParameterKind.KEYWORD_ONLY_MARKER) {
        return '*';
      }
      if (p.kind === PythonParameterKind.VAR_POSITIONAL) {
        return `*${p.name}`;
      }
      if (p.kind === PythonParameterKind.VAR_KEYWORD) {
        return `**${p.name}`;
      }
      return p.name;
    });
    return `${name}(${parts.join(', ')})`;
  }

  private buildDetailedSignature(
    name: string,
    parameters: ParameterEntry[],
    returnTypeNode: Parser.SyntaxNode | null
  ): string {
    const parts = parameters.map(p => {
      if (p.kind === PythonParameterKind.POSITIONAL_ONLY_MARKER) {
        return '/';
      }
      if (p.kind === PythonParameterKind.KEYWORD_ONLY_MARKER) {
        return '*';
      }
      const prefix =
        p.kind === PythonParameterKind.VAR_POSITIONAL
          ? '*'
          : p.kind === PythonParameterKind.VAR_KEYWORD
            ? '**'
            : '';
      const annotation = p.annotation ? `: ${p.annotation}` : '';
      const dflt = p.defaultNode
        ? ` = ${EntityUtils.normalizeWhitespace(p.defaultNode.text)}`
        : '';
      return `${prefix}${p.name}${annotation}${dflt}`;
    });
    const returns = returnTypeNode ? ` -> ${this.normalizeTypeText(returnTypeNode.text)}` : '';
    return `${name}(${parts.join(', ')})${returns}`;
  }

  // --------------------------------------------------------------- imports

  /**
   * Emits **one row per bound name**, which is the rule that decides row counts.
   *
   * ```python
   * import a.b.c            # ONE row: binds `a`, importedPath `a.b.c`
   * from m import x, y      # TWO rows
   * from . import sib       # ONE row, relativeLevel 1
   * from .m import *        # ONE row, binds nothing knowable
   * ```
   */
  private visitImport(node: Parser.SyntaxNode, context: DeclarationContext): void {
    const isFrom =
      node.type === 'import_from_statement' || node.type === 'future_import_statement';
    const line = node.startPosition.row + 1;
    const moduleNameNode = node.childForFieldName('module_name');
    const relativeLevel = this.relativeLevelOf(moduleNameNode);
    const modulePath = this.moduleTextOf(moduleNameNode, node);

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child || (isFrom && child.id === moduleNameNode?.id)) {
        continue;
      }

      if (child.type === 'wildcard_import') {
        this.pushImport(
          relativeLevel > 0 ? PythonImportKind.RELATIVE_WILDCARD : PythonImportKind.FROM_WILDCARD,
          modulePath,
          '*',
          line,
          context,
          { isWildcard: true, relativeLevel, packageOrTypeName: modulePath }
        );
        continue;
      }

      if (child.type === 'aliased_import') {
        const original = child.namedChild(0)?.text ?? '';
        const alias = child.childForFieldName('alias')?.text ?? '';
        const kind = isFrom
          ? node.type === 'future_import_statement'
            ? PythonImportKind.FUTURE
            : relativeLevel > 0
              ? PythonImportKind.RELATIVE_MEMBER
              : PythonImportKind.FROM_MEMBER_ALIAS
          : PythonImportKind.MODULE_IMPORT_ALIAS;
        this.pushImport(
          kind,
          isFrom ? this.joinModulePath(modulePath, original) : original,
          alias,
          line,
          context,
          {
            relativeLevel,
            originalName: original,
            aliasName: alias,
            isModuleImport: !isFrom,
            packageOrTypeName: isFrom ? modulePath : '',
          }
        );
        continue;
      }

      if (child.type !== 'dotted_name') {
        continue;
      }

      if (!isFrom) {
        // `import a.b.c` binds ONLY `a`; `b` and `c` are reached by attribute
        // access afterwards and are not bindings.
        const bound = child.namedChild(0)?.text ?? child.text;
        this.pushImport(
          PythonImportKind.MODULE_IMPORT,
          child.text,
          bound,
          line,
          context,
          { isModuleImport: true, originalName: child.text }
        );
        continue;
      }

      const member = child.text;
      const kind =
        node.type === 'future_import_statement'
          ? PythonImportKind.FUTURE
          : relativeLevel > 0
            ? PythonImportKind.RELATIVE_MEMBER
            : PythonImportKind.FROM_MEMBER;
      this.pushImport(kind, this.joinModulePath(modulePath, member), member, line, context, {
        relativeLevel,
        originalName: member,
        packageOrTypeName: modulePath,
      });
    }
  }

  private pushImport(
    kind: PythonImportKind,
    importedPath: string,
    simpleName: string,
    line: number,
    context: DeclarationContext,
    options: {
      relativeLevel?: number;
      originalName?: string;
      aliasName?: string;
      isWildcard?: boolean;
      isModuleImport?: boolean;
      packageOrTypeName?: string;
    }
  ): void {
    const record = PyImportRegistry.builder(
      kind,
      importedPath,
      simpleName,
      this.input.filePath,
      line,
      this.input.module.getHash(),
      this.input.serviceVersionLinkHash
    )
      .withRelativeLevel(options.relativeLevel ?? 0)
      .withNames(options.originalName ?? simpleName, options.aliasName ?? '')
      .withPackageOrTypeName(options.packageOrTypeName ?? '')
      .withFlags({
        isWildcard: options.isWildcard ?? false,
        isModuleImport: options.isModuleImport ?? false,
        isTypeCheckingOnly: context.isTypeCheckingOnly,
        isConditional: context.isConditional,
      })
      .withPyScopeLinkHash(context.bindingScopeHash)
      .withBindingLinkHash(
        this.input.bindingHashByScopeAndName.get(
          `${context.bindingScopeHash}::${simpleName}`
        ) ?? ''
      )
      .build();
    this.imports.push(record);
  }

  /** Leading dots on a relative import: `from ..pkg import x` is level 2. */
  private relativeLevelOf(moduleNameNode: Parser.SyntaxNode | null): number {
    if (!moduleNameNode || moduleNameNode.type !== 'relative_import') {
      return 0;
    }
    for (let i = 0; i < moduleNameNode.namedChildCount; i++) {
      const child = moduleNameNode.namedChild(i);
      if (child?.type === 'import_prefix') {
        return child.text.length;
      }
    }
    return 0;
  }

  private moduleTextOf(
    moduleNameNode: Parser.SyntaxNode | null,
    node: Parser.SyntaxNode
  ): string {
    if (!moduleNameNode) {
      return node.type === 'future_import_statement' ? '__future__' : '';
    }
    if (moduleNameNode.type !== 'relative_import') {
      return moduleNameNode.text;
    }
    for (let i = 0; i < moduleNameNode.namedChildCount; i++) {
      const child = moduleNameNode.namedChild(i);
      if (child?.type === 'dotted_name') {
        return child.text;
      }
    }
    return '';
  }

  private joinModulePath(modulePath: string, member: string): string {
    return modulePath.length === 0 ? member : `${modulePath}.${member}`;
  }

  // --------------------------------------------------------------- helpers

  private decoratorDottedPath(decorator: Parser.SyntaxNode): string {
    const inner = decorator.namedChild(0);
    if (!inner) {
      return '';
    }
    // `@deco(arg)` — the decorator's identity is the callee, not the call.
    const target = inner.type === 'call' ? (inner.childForFieldName('function') ?? inner) : inner;
    return EntityUtils.normalizeWhitespace(target.text);
  }

  private rightmostName(node: Parser.SyntaxNode): string {
    switch (node.type) {
      case 'identifier': {
        return node.text;
      }
      case 'attribute': {
        return node.childForFieldName('attribute')?.text ?? '';
      }
      case 'dotted_name': {
        return node.namedChild(node.namedChildCount - 1)?.text ?? '';
      }
      case 'subscript':
      case 'generic_type': {
        const value = node.childForFieldName('value') ?? node.namedChild(0);
        return value ? this.rightmostName(value) : '';
      }
      case 'call': {
        const fn = node.childForFieldName('function');
        return fn ? this.rightmostName(fn) : '';
      }
      default: {
        return '';
      }
    }
  }

  private dottedPathOf(node: Parser.SyntaxNode): string {
    if (node.type === 'identifier' || node.type === 'dotted_name') {
      return node.text;
    }
    if (node.type === 'attribute') {
      return EntityUtils.normalizeWhitespace(node.text);
    }
    return '';
  }

  /** An annotation minus its subscripts: `Optional[User]` -> `Optional`. */
  private annotationBaseType(annotation: string): string {
    if (annotation.length === 0) {
      return '';
    }
    const bracket = annotation.indexOf('[');
    return bracket < 0 ? annotation : annotation.slice(0, bracket);
  }

  private docstringOf(bodyNode: Parser.SyntaxNode | null): string {
    if (!bodyNode) {
      return '';
    }
    const first = bodyNode.namedChild(0);
    if (first?.type !== 'expression_statement') {
      return '';
    }
    const literal = first.namedChild(0);
    if (literal?.type !== 'string') {
      return '';
    }
    for (let i = 0; i < literal.namedChildCount; i++) {
      const part = literal.namedChild(i);
      if (part?.type === 'string_content') {
        return EntityUtils.normalizeWhitespace(part.text);
      }
    }
    return '';
  }

  /**
   * The end position of a declaration, **excluding trailing comments**.
   *
   * tree-sitter's `function_definition` extends to the last token inside the
   * indented block, which includes a trailing comment; CPython's `ast` reports
   * `end_lineno` as the last line of the last *statement*. They differ:
   *
   * ```python
   * def flush(self):
   *     self._checkClosed()
   *     # XXX Should this return the number of bytes written???
   * #   ^ tree-sitter ends here, ast ends on the line above
   * ```
   *
   * `ast` is the reference definition of a declaration's extent, and it is also
   * load-bearing: `endLine` is part of the `py_type` primary key, so following
   * tree-sitter would make a class's identity change when someone appends a
   * comment to its last method. Comments carry their own spans in their own
   * relation and do not need to fall inside a method's.
   */
  private declarationEndPosition(node: Parser.SyntaxNode): { row: number; column: number } {
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (!child || child.type === 'comment') {
        continue;
      }
      return this.declarationEndPosition(child);
    }
    return { row: node.endPosition.row, column: node.endPosition.column };
  }

  /**
   * Canonicalises annotation text so a multi-line annotation reads the same as
   * the single-line spelling of the same type.
   *
   * Without this, a `-> typing.Tuple[\n    int,\n    str,\n]` becomes
   * `typing.Tuple[ int, str, ]` while the same annotation written inline yields
   * `typing.Tuple[int, str]`, so two identical types compare unequal.
   */
  private normalizeTypeText(text: string): string {
    return EntityUtils.normalizeWhitespace(text)
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .replace(/\[\s+/g, '[')
      .replace(/\s+\]/g, ']')
      .replace(/\s+,/g, ',')
      .replace(/,(?=\S)/g, ', ');
  }

  private hasAsyncPrefix(node: Parser.SyntaxNode): boolean {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i)?.type === 'async') {
        return true;
      }
    }
    return false;
  }

  private containsYield(bodyNode: Parser.SyntaxNode): boolean {
    const worklist: Parser.SyntaxNode[] = [bodyNode];
    while (worklist.length > 0) {
      const node = worklist.pop();
      if (!node) {
        continue;
      }
      if (node.type === 'yield') {
        return true;
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && child.type !== 'function_definition' && child.type !== 'class_definition') {
          worklist.push(child);
        }
      }
    }
    return false;
  }
}

/** One entry in a class's base list, before it becomes a row. */
interface BaseEntry {
  node: Parser.SyntaxNode;
  baseKind: PythonBaseKind;
  /** `null` for keyword entries, which take no MRO position. */
  position: number | null;
  keywordName: string;
  baseText: string;
  isDynamic: boolean;
}

/** One parameter, before it becomes a row. */
interface ParameterEntry {
  node: Parser.SyntaxNode;
  name: string;
  kind: PythonParameterKind;
  position: number;
  annotation: string;
  annotationIsString: boolean;
  defaultNode: Parser.SyntaxNode | null;
}
