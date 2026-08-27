import * as ts from 'typescript';

import {
  ExpressionOwner,
  TsExpressionExtractor,
} from '@/parsers/typescript/extractors/ts-expression-extractor';
import { TsExpressionOwnerKind, TsRootContext } from '@/enums/typescript/expressions';
import { nodeId } from '@/parsers/typescript/extractors/ts-binder';

/** Parentheses are punctuation. A tree must never be rooted at one. */
function unwrapParenthesesExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/**
 * Finds the EXPRESSION POSITIONS in a file and starts one tree at each.
 *
 * ## Why this is an explicit allowlist and not a generic tree walk
 *
 * A generic walk that asks "is this node an expression?" is wrong in this
 * language, and wrong in the direction that fills the call graph with phantom
 * edges. `ts.forEachChild` descends into type annotations, and a
 * `TypeReferenceNode`'s `typeName` is an `Identifier` — so a generic walk emits
 * an `IDENTIFIER_REFERENCE` row for every type name in the file. So does the
 * NAME of every declaration, and so does every `implements` clause entry.
 *
 * That is precisely the failure §3.3 exists to prevent, and it would not show
 * up as an error anywhere: the rows are well-formed, the counts look plausible,
 * and the call graph quietly acquires targets that have no runtime existence.
 *
 * So expression positions are enumerated, one statement kind at a time. The
 * cost is a walk that has to be extended when a statement kind is added; the
 * benefit is that a type node cannot reach `ts_expression` by accident, only by
 * someone writing it down.
 *
 * ## The one heritage subtlety
 *
 * `class C extends B` evaluates `B` **at runtime** — it is a real value
 * reference and a real edge. `class C implements I` and `interface X extends Y`
 * evaluate nothing. So the extends clause of a CLASS produces an expression and
 * the other two produce none, which is the same distinction
 * `ts_type_heritage.inheritsMembers` draws one relation over.
 */
export interface ExpressionWalkerOptions {
  readonly sourceFile: ts.SourceFile;
  readonly extractor: TsExpressionExtractor;
  readonly moduleHash: string;
  readonly moduleInitMethodHash: string;
  readonly moduleHashForNode: (node: ts.Node) => string;
  readonly methodHashByNode: ReadonlyMap<string, string>;
  readonly typeHashByNode: ReadonlyMap<string, string>;
  readonly blockHashByNode: ReadonlyMap<string, string>;
  readonly variableHashByNode: ReadonlyMap<string, string>;
  readonly fieldHashByNode: ReadonlyMap<string, string>;
  readonly parameterHashByNode: ReadonlyMap<string, string>;
}

export class TsExpressionWalker {
  private readonly sf: ts.SourceFile;

  constructor(private readonly options: ExpressionWalkerOptions) {
    this.sf = options.sourceFile;
  }

  run(): void {
    for (const statement of this.sf.statements) {
      this.visitStatement(statement);
    }
    this.options.extractor.emitCallSites();
  }

  // -------------------------------------------------------------------------
  // owner derivation
  // -------------------------------------------------------------------------

  /**
   * Who owns the expression tree rooted at `node`.
   *
   * Derived by walking ANCESTORS against the hashes the declaration pass
   * recorded, rather than threaded through the walk. Threading it means two
   * walks that must agree about context, and when they drift the expressions
   * are attributed to the wrong owner — which reads as a resolution failure
   * rather than as an attribution bug.
   */
  private ownerFor(node: ts.Node): ExpressionOwner {
    let callerMethodHash = '';
    let callerTypeHash = '';
    let ownerHash = '';
    let ownerKind: TsExpressionOwnerKind | undefined;

    let current: ts.Node | undefined = node.parent;
    while (current) {
      const id = nodeId(current, this.sf);

      if (ownerKind === undefined) {
        if (ts.isVariableDeclaration(current)) {
          const hash = this.options.variableHashByNode.get(id);
          if (hash) {
            ownerHash = hash;
            ownerKind = TsExpressionOwnerKind.VARIABLE;
          }
        } else if (ts.isPropertyDeclaration(current) || ts.isPropertySignature(current)) {
          const hash = this.options.fieldHashByNode.get(id);
          if (hash) {
            ownerHash = hash;
            ownerKind = TsExpressionOwnerKind.FIELD;
          }
        } else if (ts.isParameter(current)) {
          const hash = this.options.parameterHashByNode.get(id);
          if (hash) {
            ownerHash = hash;
            ownerKind = TsExpressionOwnerKind.PARAMETER_DEFAULT;
          }
        } else if (ts.isDecorator(current)) {
          ownerKind = TsExpressionOwnerKind.DECORATOR;
        } else if (ts.isEnumMember(current)) {
          ownerKind = TsExpressionOwnerKind.ENUM_MEMBER;
        } else if (ts.isExportAssignment(current)) {
          ownerKind = TsExpressionOwnerKind.EXPORT;
        } else {
          const blockHash = this.options.blockHashByNode.get(id);
          if (blockHash) {
            ownerHash = blockHash;
            ownerKind = TsExpressionOwnerKind.BLOCK;
          }
        }
      }

      if (callerMethodHash === '') {
        const methodHash = this.options.methodHashByNode.get(id);
        if (methodHash) {
          callerMethodHash = methodHash;
        }
      }
      if (callerTypeHash === '' && (ts.isClassLike(current) || ts.isInterfaceDeclaration(current))) {
        callerTypeHash = this.options.typeHashByNode.get(id) ?? '';
      }
      current = current.parent;
    }

    // Top-level executable code belongs to the synthetic `<module>` initializer.
    // Every call site has a caller; there is no such thing as an orphan call.
    if (callerMethodHash === '') {
      callerMethodHash = this.options.moduleInitMethodHash;
    }
    if (ownerKind === undefined) {
      ownerHash = callerMethodHash;
      ownerKind = callerMethodHash === this.options.moduleInitMethodHash
        ? TsExpressionOwnerKind.MODULE_INIT
        : TsExpressionOwnerKind.METHOD;
    }
    if (ownerHash === '') {
      ownerHash = callerMethodHash;
    }
    return {
      ownerHash,
      ownerKind,
      typeHash: callerTypeHash,
      moduleHash: this.options.moduleHashForNode(node),
      callerMethodHash,
      callerTypeHash,
    };
  }

  /**
   * Starts a tree at `node` and then follows into any nested function bodies.
   *
   * The descent is not optional and forgetting it is silent. The worklist stops
   * at an arrow or function expression — the body belongs to that function's own
   * `ts_method` row, not to the enclosing tree — so without a second step every
   * call inside `return function () { … }` or `return () => { … }` vanishes. It
   * cost 45 of 691 call sites on the fixture corpus, all of them in decorator
   * factories, and nothing about the output looked wrong: the rows that were
   * emitted were correct, there were just fewer of them.
   */
  private root(node: ts.Expression | undefined, rootContext: TsRootContext): void {
    if (!node) {
      return;
    }
    this.options.extractor.extractRoot(node, this.ownerFor(node), rootContext);
    this.descend(node);
  }

  /** Follows a node into the function and class bodies the worklist did not enter. */
  private descend(node: ts.Node): void {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      this.visitFunctionLike(node);
      return;
    }
    if (ts.isClassExpression(node)) {
      this.visitClassLike(node);
      return;
    }
    this.visitNestedFunctions(node);
  }

  // -------------------------------------------------------------------------
  // statements
  // -------------------------------------------------------------------------

  private visitStatement(node: ts.Statement): void {
    switch (node.kind) {
      case ts.SyntaxKind.ExpressionStatement: {
        this.root((node as ts.ExpressionStatement).expression,
          TsRootContext.EXPRESSION_STATEMENT);
        return;
      }
      case ts.SyntaxKind.VariableStatement: {
        for (const declaration of (node as ts.VariableStatement).declarationList.declarations) {
          this.visitVariableDeclaration(declaration);
        }
        return;
      }
      case ts.SyntaxKind.ReturnStatement: {
        this.root((node as ts.ReturnStatement).expression, TsRootContext.RETURN_VALUE);
        return;
      }
      case ts.SyntaxKind.ThrowStatement: {
        this.root((node as ts.ThrowStatement).expression, TsRootContext.THROW_VALUE);
        return;
      }
      case ts.SyntaxKind.IfStatement: {
        const statement = node as ts.IfStatement;
        this.root(statement.expression, TsRootContext.CONDITION);
        this.visitStatement(statement.thenStatement);
        if (statement.elseStatement) {
          this.visitStatement(statement.elseStatement);
        }
        return;
      }
      case ts.SyntaxKind.Block: {
        for (const statement of (node as ts.Block).statements) {
          this.visitStatement(statement);
        }
        return;
      }
      case ts.SyntaxKind.ForStatement: {
        const statement = node as ts.ForStatement;
        if (statement.initializer) {
          if (ts.isVariableDeclarationList(statement.initializer)) {
            for (const declaration of statement.initializer.declarations) {
              this.visitVariableDeclaration(declaration);
            }
          } else {
            this.root(statement.initializer, TsRootContext.LOOP_HEADER);
          }
        }
        this.root(statement.condition, TsRootContext.CONDITION);
        this.root(statement.incrementor, TsRootContext.LOOP_HEADER);
        this.visitStatement(statement.statement);
        return;
      }
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement: {
        const statement = node as ts.ForInStatement | ts.ForOfStatement;
        if (ts.isVariableDeclarationList(statement.initializer)) {
          for (const declaration of statement.initializer.declarations) {
            this.visitVariableDeclaration(declaration);
          }
        } else {
          this.root(statement.initializer, TsRootContext.LOOP_HEADER);
        }
        this.root(statement.expression, TsRootContext.LOOP_HEADER);
        this.visitStatement(statement.statement);
        return;
      }
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement: {
        const statement = node as ts.WhileStatement | ts.DoStatement;
        this.root(statement.expression, TsRootContext.CONDITION);
        this.visitStatement(statement.statement);
        return;
      }
      case ts.SyntaxKind.SwitchStatement: {
        const statement = node as ts.SwitchStatement;
        this.root(statement.expression, TsRootContext.SWITCH_SUBJECT);
        for (const clause of statement.caseBlock.clauses) {
          if (ts.isCaseClause(clause)) {
            this.root(clause.expression, TsRootContext.CASE_LABEL);
          }
          for (const inner of clause.statements) {
            this.visitStatement(inner);
          }
        }
        return;
      }
      case ts.SyntaxKind.TryStatement: {
        const statement = node as ts.TryStatement;
        this.visitStatement(statement.tryBlock);
        if (statement.catchClause) {
          this.visitStatement(statement.catchClause.block);
        }
        if (statement.finallyBlock) {
          this.visitStatement(statement.finallyBlock);
        }
        return;
      }
      case ts.SyntaxKind.LabeledStatement: {
        this.visitStatement((node as ts.LabeledStatement).statement);
        return;
      }
      case ts.SyntaxKind.FunctionDeclaration: {
        this.visitFunctionLike(node as ts.FunctionDeclaration);
        return;
      }
      case ts.SyntaxKind.ClassDeclaration: {
        this.visitClassLike(node as ts.ClassDeclaration);
        return;
      }
      case ts.SyntaxKind.EnumDeclaration: {
        for (const member of (node as ts.EnumDeclaration).members) {
          this.visitDecorators(member);
          this.root(member.initializer, TsRootContext.ENUM_MEMBER_VALUE);
        }
        return;
      }
      case ts.SyntaxKind.ModuleDeclaration: {
        const body = (node as ts.ModuleDeclaration).body;
        if (body && ts.isModuleBlock(body)) {
          for (const statement of body.statements) {
            this.visitStatement(statement);
          }
        } else if (body && ts.isModuleDeclaration(body)) {
          this.visitStatement(body);
        }
        return;
      }
      case ts.SyntaxKind.ExportAssignment: {
        this.root((node as ts.ExportAssignment).expression, TsRootContext.EXPORT_VALUE);
        return;
      }
      default: {
        // An interface, a type alias, an import or an export declaration. All
        // type-level or binding-level; none of them contains an expression, and
        // descending would put type names into `ts_expression`.
        return;
      }
    }
  }

  private visitVariableDeclaration(node: ts.VariableDeclaration): void {
    // The function itself is a `ts_method` row and its body belongs to that
    // method — but the function expression is still a value in the initialiser
    // position, so the tree starts here and `root` follows into the body.
    this.root(node.initializer, TsRootContext.VARIABLE_INITIALIZER);
  }

  private visitFunctionLike(node: ts.SignatureDeclaration | ts.ClassStaticBlockDeclaration): void {
    this.visitDecorators(node);
    if (!ts.isClassStaticBlockDeclaration(node)) {
      for (const parameter of node.parameters) {
        this.visitDecorators(parameter);
        this.root(parameter.initializer, TsRootContext.PARAMETER_DEFAULT);
      }
    }
    const body = (node as { body?: ts.Node }).body;
    if (!body) {
      return;
    }
    if (ts.isBlock(body)) {
      for (const statement of body.statements) {
        this.visitStatement(statement);
      }
      return;
    }
    // A concise arrow body is an expression in its own right, owned by the
    // arrow's method row.
    this.root(body as ts.Expression, TsRootContext.ARROW_BODY_EXPRESSION);
  }

  private visitClassLike(node: ts.ClassLikeDeclaration): void {
    this.visitDecorators(node);
    for (const clause of node.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword || ts.isInterfaceDeclaration(node.parent)) {
        continue;
      }
      for (const type of clause.types) {
        // A class `extends` clause is EVALUATED at runtime, including the mixin
        // form `extends mixin(Base)`. `implements` is not, and is skipped
        // above — emitting it would put a type-only name in the call graph.
        this.root(type.expression, TsRootContext.HERITAGE_EXPRESSION);
      }
    }
    for (const member of node.members) {
      // Decorators are visited by exactly ONE path per member. Visiting them
      // here AND inside visitFunctionLike emitted every method decorator's call
      // twice — and because the two rows had identical owner, role, position and
      // position-in-file, they had the identical PRIMARY KEY. Duplicate rows
      // under one key do not fail a join, they double a count, which is why the
      // fact-base invariants check exists and why it found this before the
      // resolution comparison did.
      if (ts.isPropertyDeclaration(member)) {
        this.visitDecorators(member);
        this.visitComputedName(member.name);
        this.root(member.initializer, TsRootContext.FIELD_INITIALIZER);
        continue;
      }
      if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)
        || ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
        this.visitComputedName(member.name);
        this.visitFunctionLike(member);
        continue;
      }
      if (ts.isClassStaticBlockDeclaration(member)) {
        this.visitFunctionLike(member);
        continue;
      }
    }
  }

  private visitComputedName(name: ts.PropertyName | undefined): void {
    if (name && ts.isComputedPropertyName(name)) {
      this.root(name.expression, TsRootContext.COMPUTED_PROPERTY_NAME);
    }
  }

  /**
   * A decorator is an EXPRESSION THAT RUNS.
   *
   * That is the whole difference from a Java annotation, which is inert
   * metadata. `@Component({...})` is a call at class-definition time, so it
   * belongs in the call graph and its arguments are real values.
   */
  private visitDecorators(node: ts.Node): void {
    for (const decorator of ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : []) {
      // `@(record("x"))` has been legal since TypeScript 5.0. The parentheses
      // are punctuation and produce no row, so a tree rooted at them would be
      // rooted at nothing and the call inside would never be emitted.
      this.root(unwrapParenthesesExpression(decorator.expression),
        TsRootContext.DECORATOR_EXPRESSION);
    }
  }

  /**
   * Descends an already-extracted tree looking only for nested function bodies.
   *
   * The tree itself was emitted by the worklist, which stops at an arrow rather
   * than descending into it — an arrow's body belongs to the arrow's own
   * `ts_method` row, not to the enclosing expression. This finds those bodies
   * without re-emitting the tree above them.
   */
  private visitNestedFunctions(node: ts.Node): void {
    ts.forEachChild(node, (child) => {
      if (ts.isArrowFunction(child) || ts.isFunctionExpression(child)) {
        this.visitFunctionLike(child);
        return;
      }
      if (ts.isClassExpression(child)) {
        this.visitClassLike(child);
        return;
      }
      // An object-literal method has its own `ts_method` row, so its body is
      // walked under that owner rather than descended into as part of the
      // enclosing expression tree.
      if (child.parent && ts.isObjectLiteralExpression(child.parent)
        && (ts.isMethodDeclaration(child) || ts.isGetAccessor(child)
          || ts.isSetAccessor(child))) {
        this.visitFunctionLike(child);
        return;
      }
      if (ts.isTypeNode(child)) {
        // Never descend into a type node. This is the structural guarantee of
        // §3.3 restated at the one place a walk could violate it.
        return;
      }
      this.visitNestedFunctions(child);
    });
  }
}
