import * as ts from 'typescript';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TS_DEFAULT_EXPORT_NAME } from '@/constants/typescript-constants';
import { TS_MERGE_SCOPE } from '@/enums/typescript/modules';
import { TsDeclarationSpace } from '@/enums/typescript/types';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A SYNTACTIC binder — scopes, symbol tables and merge-scope keys, with no checker.
 *
 * ## What this is for, and what it is not
 *
 * It is not a typechecker and it does not become one. It answers two questions
 * that pure syntax-directed extraction cannot answer on its own:
 *
 * 1. **Which declarations are the same symbol?** That is §3.1, and it is the
 *    thing that must be right before any other key exists. TypeScript's own rule
 *    is that a symbol *is* a `(symbol table, escaped name)` pair and merging *is*
 *    "same table, same name", so reproducing the table is reproducing the rule —
 *    right by construction rather than by approximation.
 * 2. **What does this identifier refer to?** Needed for
 *    `ts_expression.referencedEntityHash` and for the syntactically decidable
 *    half of call resolution.
 *
 * Both are pure functions of the AST plus module resolution, which is why this
 * is parser-legal. Nothing here calls `getTypeAtLocation`, and nothing here
 * needs a `ts.Program`.
 *
 * ## Two tables, not one, because TypeScript has two
 *
 * `var` and function declarations go to the nearest FUNCTION scope; `let`,
 * `const`, classes, enums, interfaces, type aliases, namespaces and imports go
 * to the nearest BLOCK scope. Collapsing them into one table merges two
 * `const x` declarations in sibling blocks of one function into a single symbol,
 * which tsc does not do — and the failure is silent, because the resulting
 * partition still looks like a partition.
 *
 * ## A note on the schema's `LOCALS:<tsMethodLinkHash>`
 *
 * §3.1 writes the local merge key as `LOCALS:<tsMethodLinkHash>`. This
 * implementation uses `LOCALS:<scope hash>` — the same prefix, keyed on the
 * BINDER SCOPE rather than the enclosing method. That is a refinement, not a
 * divergence: keying on the method would merge two same-named block-scoped
 * declarations inside one function into one symbol, and the oracle adjudicates
 * the partition by set equality in both directions, so the coarser key would
 * fail the very gate the formula exists to pass. The scope hash is derived from
 * the module hash and the scope node's BYTE RANGE, so it is stable across runs
 * and independent of traversal order.
 */

/** What a bound declaration is, in the vocabulary the oracle's partition uses. */
export enum TsBoundKind {
  ClassDeclaration = 'ClassDeclaration',
  EnumDeclaration = 'EnumDeclaration',
  FunctionDeclaration = 'FunctionDeclaration',
  InterfaceDeclaration = 'InterfaceDeclaration',
  ModuleDeclaration = 'ModuleDeclaration',
  TypeAliasDeclaration = 'TypeAliasDeclaration',
  VariableDeclaration = 'VariableDeclaration',
  /** Binding-pattern elements. A symbol in tsc, but NOT a `VariableDeclaration` node. */
  BindingElement = 'BindingElement',
  Parameter = 'Parameter',
  ImportBinding = 'ImportBinding',
  ClassExpression = 'ClassExpression',
  FunctionExpression = 'FunctionExpression',
  TypeParameter = 'TypeParameter',
}

/** Which scopes exist. A scope may be a var scope, a block scope, or both. */
export enum TsScopeKind {
  SOURCE_FILE = 'SOURCE_FILE',
  /** `declare module "x" { … }` — its own importable namespace and merge table. */
  AMBIENT_MODULE = 'AMBIENT_MODULE',
  /** `declare global { … }` — declarations land in GLOBAL. */
  GLOBAL_AUGMENTATION = 'GLOBAL_AUGMENTATION',
  NAMESPACE = 'NAMESPACE',
  FUNCTION = 'FUNCTION',
  BLOCK = 'BLOCK',
  /** Holds type parameters and, for a named class expression, the class's own name. */
  TYPE_CONTAINER = 'TYPE_CONTAINER',
}

export interface BoundDeclaration {
  readonly name: string;
  readonly escapedName: string;
  readonly kind: TsBoundKind;
  readonly node: ts.Node;
  /** The node whose position identifies the declaration SITE, per the oracle's convention. */
  readonly siteNode: ts.Node;
  readonly mergeScopeKey: string;
  readonly declarationGroupKey: string;
  readonly declarationSpaces: ReadonlySet<TsDeclarationSpace>;
  readonly isExported: boolean;
  readonly scope: TsScope;
}

export interface TsScope {
  readonly kind: TsScopeKind;
  readonly node: ts.Node;
  readonly parent: TsScope | undefined;
  readonly depth: number;
  readonly scopeHash: string;
  readonly isVarScope: boolean;
  readonly isBlockScope: boolean;
  /** `var` and function declarations. */
  readonly varTable: Map<string, BoundDeclaration[]>;
  /** `let`, `const`, class, enum, interface, type alias, namespace, import. */
  readonly blockTable: Map<string, BoundDeclaration[]>;
  /**
   * The merge-scope key declarations in this scope receive.
   *
   * A pair, because exported and non-exported declarations of one name in one
   * module are two symbols, not one — tsc rejects mixing them (TS2395), which
   * is the evidence that the tables really are separate.
   */
  readonly exportedMergeScopeKey: string;
  readonly localMergeScopeKey: string;
  /** For a namespace scope: the group key of the namespace declaration itself. */
  readonly namespaceGroupKey: string;
}

/**
 * How the binder learns a module specifier's target without a Program.
 *
 * Returns both the target module's hash — which is what an augmentation's
 * declarations must be keyed under — and a PROJECT-RELATIVE path, which is what
 * the augmentation's own symbol is named after. tsc names that symbol with the
 * absolute resolved path; this parser uses the relative one, because an absolute
 * path in a fact table is machine-specific and would make two identical
 * analyses on two machines produce different keys.
 */
export interface ResolvedModuleTarget {
  readonly moduleHash: string;
  /** Project-relative, extension stripped, `/` separated. */
  readonly relativePath: string;
}
export type ModuleHashResolver = (
  specifier: string,
  fromFile: string
) => ResolvedModuleTarget | undefined;

export interface BinderResult {
  readonly fileScope: TsScope;
  /** Every bound declaration, by node identity. */
  readonly bindingByNode: ReadonlyMap<string, BoundDeclaration>;
  /** The innermost scope containing each node that opens one, by node identity. */
  readonly scopeByNode: ReadonlyMap<string, TsScope>;
  /** Class and interface member tables, by the declaration node's identity. */
  readonly memberTableByOwner: ReadonlyMap<string, Map<string, ts.Node[]>>;
  /** Every declaration in source order — the emission order, and therefore the byte order. */
  readonly declarationsInOrder: readonly BoundDeclaration[];
}

/**
 * Node identity: the byte RANGE, never the start offset.
 *
 * A start offset alone is ambiguous — a `ParenthesizedExpression` and its
 * operand can begin at the same character, and so can a declaration and its
 * name. The node kind is included because a node with exactly one child can
 * span exactly the child's range, and two entries under one identity is the
 * silent-eviction failure that side tables keyed on wrappers produce at scale.
 */
export function nodeId(node: ts.Node, sourceFile: ts.SourceFile): string {
  return `${node.kind}:${node.getStart(sourceFile)}:${node.end}`;
}

/** md5 over `mergeScopeKey ‖ escapedName` — the merged entity's identity (§3.1). */
export function declarationGroupKeyFor(mergeScopeKey: string, escapedName: string): string {
  return EntityUtils.generateEntityHash(
    ENTITY_IDENTIFIERS.TS_DECLARATION_GROUP,
    `${mergeScopeKey}||${escapedName}`
  );
}

export interface BinderOptions {
  readonly sourceFile: ts.SourceFile;
  readonly moduleHash: string;
  readonly isExternalModule: boolean;
  readonly filePath: string;
  /**
   * Resolves `declare module "./x"` to the augmented module's hash.
   *
   * This is why `ts.resolveModuleName` being parser-legal matters to the KEY and
   * not merely to `ts_import`: a module augmentation's declarations must land in
   * the TARGET module's table, or `Request` in `augmented-base.ts` and `Request`
   * inside `declare module "./augmented-base"` are two symbols instead of one.
   */
  readonly resolveModuleHash: ModuleHashResolver;
  /** Hashes minted for ambient-module and global-augmentation `ts_module` rows. */
  readonly ambientModuleHashes: ReadonlyMap<string, string>;
}

export function bindSourceFile(options: BinderOptions): BinderResult {
  return new Binder(options).run();
}

class Binder {
  private readonly sf: ts.SourceFile;
  private readonly bindingByNode = new Map<string, BoundDeclaration>();
  private readonly scopeByNode = new Map<string, TsScope>();
  private readonly memberTableByOwner = new Map<string, Map<string, ts.Node[]>>();
  private readonly declarationsInOrder: BoundDeclaration[] = [];
  private ambientScope: TsScope | undefined;

  constructor(private readonly options: BinderOptions) {
    this.sf = options.sourceFile;
  }

  run(): BinderResult {
    const fileScope = this.makeScope(
      this.sf,
      this.options.isExternalModule ? TsScopeKind.SOURCE_FILE : TsScopeKind.SOURCE_FILE,
      undefined,
      true,
      true,
      this.options.isExternalModule
        ? `${TS_MERGE_SCOPE.MODULE_EXPORTS}:${this.options.moduleHash}`
        : TS_MERGE_SCOPE.GLOBAL,
      this.options.isExternalModule
        ? `${TS_MERGE_SCOPE.MODULE_LOCALS}:${this.options.moduleHash}`
        : TS_MERGE_SCOPE.GLOBAL,
      ''
    );
    this.scopeByNode.set(nodeId(this.sf, this.sf), fileScope);
    for (const statement of this.sf.statements) {
      this.visit(statement, fileScope, fileScope, fileScope);
    }
    return {
      fileScope,
      bindingByNode: this.bindingByNode,
      scopeByNode: this.scopeByNode,
      memberTableByOwner: this.memberTableByOwner,
      declarationsInOrder: this.declarationsInOrder,
    };
  }

  // -------------------------------------------------------------------------
  // scope construction
  // -------------------------------------------------------------------------

  private makeScope(
    node: ts.Node,
    kind: TsScopeKind,
    parent: TsScope | undefined,
    isVarScope: boolean,
    isBlockScope: boolean,
    exportedMergeScopeKey: string,
    localMergeScopeKey: string,
    namespaceGroupKey: string
  ): TsScope {
    return {
      kind,
      node,
      parent,
      depth: parent ? parent.depth + 1 : 0,
      // Derived from the module hash and the scope node's BYTE RANGE, so it is
      // stable across runs and does not depend on traversal order.
      scopeHash: EntityUtils.generateEntityHash(
        ENTITY_IDENTIFIERS.TS_DECLARATION_GROUP,
        `SCOPE||${this.options.moduleHash}||${node.kind}||${node.getStart(this.sf)}||${node.end}`
      ),
      isVarScope,
      isBlockScope,
      varTable: new Map(),
      blockTable: new Map(),
      exportedMergeScopeKey,
      localMergeScopeKey,
      namespaceGroupKey,
    };
  }

  /** A plain lexical scope: everything declared in it is local, so both keys agree. */
  private makeLocalScope(node: ts.Node, kind: TsScopeKind, parent: TsScope,
                         isVarScope: boolean, isBlockScope: boolean): TsScope {
    const scope = this.makeScope(node, kind, parent, isVarScope, isBlockScope, '', '', '');
    const key = `${TS_MERGE_SCOPE.LOCALS}:${scope.scopeHash}`;
    const withKeys: TsScope = { ...scope, exportedMergeScopeKey: key, localMergeScopeKey: key };
    this.scopeByNode.set(nodeId(node, this.sf), withKeys);
    return withKeys;
  }

  // -------------------------------------------------------------------------
  // traversal
  // -------------------------------------------------------------------------

  /**
   * @param varScope   where `var` and function declarations land
   * @param blockScope where `let`/`const`/class/interface/type/enum/namespace land
   * @param nearest    the innermost scope, for reference resolution
   */
  private visit(node: ts.Node, varScope: TsScope, blockScope: TsScope, nearest: TsScope): void {
    switch (node.kind) {
      case ts.SyntaxKind.FunctionDeclaration: {
        this.bindNamed(node as ts.FunctionDeclaration, TsBoundKind.FunctionDeclaration, varScope,
          new Set([TsDeclarationSpace.VALUE]));
        this.visitFunctionLike(node as ts.FunctionDeclaration, nearest);
        return;
      }
      case ts.SyntaxKind.ClassDeclaration: {
        this.bindNamed(node as ts.ClassDeclaration, TsBoundKind.ClassDeclaration, blockScope,
          new Set([TsDeclarationSpace.TYPE, TsDeclarationSpace.VALUE]));
        this.visitClassLike(node as ts.ClassDeclaration, nearest);
        return;
      }
      case ts.SyntaxKind.InterfaceDeclaration: {
        this.bindNamed(node as ts.InterfaceDeclaration, TsBoundKind.InterfaceDeclaration, blockScope,
          new Set([TsDeclarationSpace.TYPE]));
        this.recordMembers(node, (node as ts.InterfaceDeclaration).members);
        this.visitTypeContainerChildren(node as ts.InterfaceDeclaration, nearest);
        return;
      }
      case ts.SyntaxKind.TypeAliasDeclaration: {
        this.bindNamed(node as ts.TypeAliasDeclaration, TsBoundKind.TypeAliasDeclaration, blockScope,
          new Set([TsDeclarationSpace.TYPE]));
        this.visitTypeContainerChildren(node as ts.TypeAliasDeclaration, nearest);
        return;
      }
      case ts.SyntaxKind.EnumDeclaration: {
        // An enum occupies all three spaces: it is a type, a value, and a
        // namespace whose members are reachable by qualified name.
        this.bindNamed(node as ts.EnumDeclaration, TsBoundKind.EnumDeclaration, blockScope,
          new Set([
            TsDeclarationSpace.NAMESPACE,
            TsDeclarationSpace.TYPE,
            TsDeclarationSpace.VALUE,
          ]));
        return;
      }
      case ts.SyntaxKind.ModuleDeclaration: {
        this.visitModuleDeclaration(node as ts.ModuleDeclaration, varScope, blockScope, nearest);
        return;
      }
      case ts.SyntaxKind.VariableStatement: {
        const statement = node as ts.VariableStatement;
        this.bindVariableDeclarationList(statement.declarationList, varScope, blockScope, nearest,
          hasModifier(statement, ts.SyntaxKind.ExportKeyword));
        return;
      }
      case ts.SyntaxKind.ImportDeclaration:
      case ts.SyntaxKind.ImportEqualsDeclaration: {
        this.bindImport(node, blockScope);
        return;
      }
      case ts.SyntaxKind.Block: {
        const scope = this.makeLocalScope(node, TsScopeKind.BLOCK, nearest, false, true);
        for (const child of (node as ts.Block).statements) {
          this.visit(child, varScope, scope, scope);
        }
        return;
      }
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement: {
        this.visitForStatement(node as ts.IterationStatement, varScope, nearest);
        return;
      }
      case ts.SyntaxKind.CatchClause: {
        this.visitCatchClause(node as ts.CatchClause, varScope, nearest);
        return;
      }
      case ts.SyntaxKind.CaseBlock: {
        // One scope for the whole switch body, matching the binder: a `let` in
        // `case 1:` is visible in `case 2:`, which is why the classic
        // fall-through redeclaration is an error rather than a shadow.
        const scope = this.makeLocalScope(node, TsScopeKind.BLOCK, nearest, false, true);
        for (const clause of (node as ts.CaseBlock).clauses) {
          for (const statement of clause.statements) {
            this.visit(statement, varScope, scope, scope);
          }
        }
        return;
      }
      case ts.SyntaxKind.FunctionExpression:
      case ts.SyntaxKind.ArrowFunction:
      case ts.SyntaxKind.MethodDeclaration:
      case ts.SyntaxKind.Constructor:
      case ts.SyntaxKind.GetAccessor:
      case ts.SyntaxKind.SetAccessor:
      case ts.SyntaxKind.ClassStaticBlockDeclaration: {
        this.visitFunctionLike(node as ts.SignatureDeclaration, nearest);
        return;
      }
      case ts.SyntaxKind.ClassExpression: {
        this.visitClassLike(node as ts.ClassExpression, nearest);
        return;
      }
      default: {
        ts.forEachChild(node, (child) => {
          this.visit(child, varScope, blockScope, nearest);
        });
        return;
      }
    }
  }

  private visitModuleDeclaration(
    node: ts.ModuleDeclaration,
    varScope: TsScope,
    blockScope: TsScope,
    nearest: TsScope
  ): void {
    const body = node.body;
    if (ts.isStringLiteral(node.name)) {
      // `declare module "x"` — an ambient module or an augmentation. Its
      // declarations belong to the TARGET module's table, which is what makes
      // `Request` here and `Request` in the augmented file one symbol.
      const specifier = node.name.text;
      const resolved = this.options.resolveModuleHash(specifier, this.options.filePath);
      const targetHash =
        resolved?.moduleHash ??
        this.options.ambientModuleHashes.get(specifier) ??
        this.options.moduleHash;

      // The declaration NODE is itself a declaration site, of the module
      // symbol. tsc names that symbol with the quoted specifier for a bare
      // module and with the quoted resolved path for an augmentation, and both
      // live in the one global table of ambient modules — which is why two
      // files declaring `declare module "*.svg"` are one symbol, and why two
      // files augmenting the same module are too.
      this.bindLocal(
        node,
        `"${resolved ? resolved.relativePath : specifier}"`,
        TsBoundKind.ModuleDeclaration,
        this.globalAmbientScope(),
        node,
        new Set([TsDeclarationSpace.NAMESPACE, TsDeclarationSpace.VALUE]),
        false,
        true
      );

      const scope = this.makeScope(
        node,
        TsScopeKind.AMBIENT_MODULE,
        nearest,
        true,
        true,
        `${TS_MERGE_SCOPE.MODULE_EXPORTS}:${targetHash}`,
        `${TS_MERGE_SCOPE.MODULE_EXPORTS}:${targetHash}`,
        ''
      );
      this.scopeByNode.set(nodeId(node, this.sf), scope);
      if (body && ts.isModuleBlock(body)) {
        for (const statement of body.statements) {
          this.visit(statement, scope, scope, scope);
        }
      }
      return;
    }

    if (node.flags & ts.NodeFlags.GlobalAugmentation) {
      // `declare global { … }` — everything inside lands in GLOBAL, from inside
      // a module. This is how a module contributes to the global scope without
      // being a script.
      //
      // The `global` node is itself a declaration of tsc's reserved `__global`
      // symbol, so N `declare global` blocks across N files are one symbol.
      // The name is passed unescaped: `__global` is already an internal name
      // and escaping it again would produce `___global` and split the group.
      this.bindLocal(
        node,
        TS_GLOBAL_SYMBOL_NAME,
        TsBoundKind.ModuleDeclaration,
        this.globalAmbientScope(),
        node,
        new Set([TsDeclarationSpace.NAMESPACE, TsDeclarationSpace.VALUE]),
        false,
        true
      );
      const scope = this.makeScope(
        node,
        TsScopeKind.GLOBAL_AUGMENTATION,
        nearest,
        true,
        true,
        TS_MERGE_SCOPE.GLOBAL,
        TS_MERGE_SCOPE.GLOBAL,
        ''
      );
      this.scopeByNode.set(nodeId(node, this.sf), scope);
      if (body && ts.isModuleBlock(body)) {
        for (const statement of body.statements) {
          this.visit(statement, scope, scope, scope);
        }
      }
      return;
    }

    // A named namespace. It occupies NAMESPACE always, and VALUE only when it
    // is INSTANTIATED — a namespace holding nothing but types is erased
    // entirely and has no runtime existence to record.
    const spaces = new Set<TsDeclarationSpace>([TsDeclarationSpace.NAMESPACE]);
    if (isInstantiatedNamespace(node)) {
      spaces.add(TsDeclarationSpace.VALUE);
    }
    const binding = this.bindNamed(node, TsBoundKind.ModuleDeclaration, blockScope, spaces);
    if (!body) {
      return;
    }
    if (ts.isModuleDeclaration(body)) {
      // `namespace A.B.C {}` — the dotted form nests one namespace per segment.
      this.visitModuleDeclaration(body, varScope, blockScope, nearest);
      return;
    }
    if (!ts.isModuleBlock(body)) {
      return;
    }
    const scope = this.makeScope(
      body,
      TsScopeKind.NAMESPACE,
      nearest,
      true,
      true,
      // Exported members belong to the NAMESPACE's table, keyed by the
      // namespace's own group key, so a member survives the namespace merging
      // with a class, a function or an enum of the same name.
      `${TS_MERGE_SCOPE.NS}:${binding?.declarationGroupKey ?? ''}`,
      '',
      binding?.declarationGroupKey ?? ''
    );
    // Non-exported members are locals of the module block, not of the
    // namespace symbol, so they can never be reached by qualified name.
    const withLocal: TsScope = {
      ...scope,
      localMergeScopeKey: `${TS_MERGE_SCOPE.LOCALS}:${scope.scopeHash}`,
    };
    this.scopeByNode.set(nodeId(body, this.sf), withLocal);
    for (const statement of body.statements) {
      this.visit(statement, withLocal, withLocal, withLocal);
    }
  }

  private visitForStatement(node: ts.IterationStatement, varScope: TsScope, nearest: TsScope): void {
    // The loop header is its own block scope: `for (let i = ...)` re-binds `i`
    // per iteration and `i` is not visible outside the loop.
    const scope = this.makeLocalScope(node, TsScopeKind.BLOCK, nearest, false, true);
    if (ts.isForStatement(node)) {
      if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
        this.bindVariableDeclarationList(node.initializer, varScope, scope, scope, false);
      } else if (node.initializer) {
        this.visit(node.initializer, varScope, scope, scope);
      }
      for (const part of [node.condition, node.incrementor]) {
        if (part) {
          this.visit(part, varScope, scope, scope);
        }
      }
    } else if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      if (ts.isVariableDeclarationList(node.initializer)) {
        this.bindVariableDeclarationList(node.initializer, varScope, scope, scope, false);
      } else {
        this.visit(node.initializer, varScope, scope, scope);
      }
      this.visit(node.expression, varScope, scope, scope);
    }
    this.visit(node.statement, varScope, scope, scope);
  }

  private visitCatchClause(node: ts.CatchClause, varScope: TsScope, nearest: TsScope): void {
    const scope = this.makeLocalScope(node, TsScopeKind.BLOCK, nearest, false, true);
    if (node.variableDeclaration) {
      // tsc's node for a catch binding IS a VariableDeclaration, so it appears
      // in the merge partition as one. Its scope is the catch clause, never the
      // enclosing block.
      this.bindVariableDeclaration(node.variableDeclaration, scope, scope, false);
    }
    for (const statement of node.block.statements) {
      this.visit(statement, varScope, scope, scope);
    }
  }

  private visitFunctionLike(node: ts.SignatureDeclaration | ts.ClassStaticBlockDeclaration,
                            nearest: TsScope): void {
    const scope = this.makeLocalScope(node, TsScopeKind.FUNCTION, nearest, true, true);
    if (!ts.isClassStaticBlockDeclaration(node)) {
      for (const typeParameter of node.typeParameters ?? []) {
        this.bindLocal(typeParameter, typeParameter.name.text, TsBoundKind.TypeParameter, scope,
          typeParameter, new Set(), false);
      }
      for (const parameter of node.parameters) {
        this.bindBindingName(parameter.name, parameter, TsBoundKind.Parameter, scope, scope, false);
        if (parameter.initializer) {
          this.visit(parameter.initializer, scope, scope, scope);
        }
      }
    }
    const body = (node as { body?: ts.Node }).body;
    if (!body) {
      return;
    }
    if (ts.isBlock(body)) {
      // The function body shares the function's scope: `var` in a body belongs
      // to the function, not to a nested block.
      for (const statement of body.statements) {
        this.visit(statement, scope, scope, scope);
      }
      return;
    }
    // A concise arrow body is an expression, not a block.
    this.visit(body, scope, scope, scope);
  }

  private visitClassLike(node: ts.ClassLikeDeclaration, nearest: TsScope): void {
    const scope = this.makeLocalScope(node, TsScopeKind.TYPE_CONTAINER, nearest, false, true);
    for (const typeParameter of node.typeParameters ?? []) {
      this.bindLocal(typeParameter, typeParameter.name.text, TsBoundKind.TypeParameter, scope,
        typeParameter, new Set(), false);
    }
    this.recordMembers(node, node.members);
    for (const member of node.members) {
      this.visit(member, scope, scope, scope);
    }
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types) {
        this.visit(type, scope, scope, scope);
      }
    }
  }

  private visitTypeContainerChildren(
    node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
    nearest: TsScope
  ): void {
    const scope = this.makeLocalScope(node, TsScopeKind.TYPE_CONTAINER, nearest, false, true);
    for (const typeParameter of node.typeParameters ?? []) {
      this.bindLocal(typeParameter, typeParameter.name.text, TsBoundKind.TypeParameter, scope,
        typeParameter, new Set(), false);
    }
  }

  private recordMembers(owner: ts.Node, members: readonly ts.ClassElement[] | readonly ts.TypeElement[]): void {
    const table = new Map<string, ts.Node[]>();
    for (const member of members) {
      const name = memberName(member);
      if (name === undefined) {
        continue;
      }
      const existing = table.get(name);
      if (existing) {
        existing.push(member);
      } else {
        table.set(name, [member]);
      }
    }
    this.memberTableByOwner.set(nodeId(owner, this.sf), table);
  }

  // -------------------------------------------------------------------------
  // binding
  // -------------------------------------------------------------------------

  private bindVariableDeclarationList(
    list: ts.VariableDeclarationList,
    varScope: TsScope,
    blockScope: TsScope,
    nearest: TsScope,
    isExported: boolean
  ): void {
    // `var` is function-scoped and `let`/`const` are block-scoped. That is the
    // whole reason there are two tables.
    const isVar = (list.flags & ts.NodeFlags.BlockScoped) === 0;
    const target = isVar ? varScope : blockScope;
    for (const declaration of list.declarations) {
      this.bindVariableDeclaration(declaration, target, nearest, isExported);
    }
  }

  private bindVariableDeclaration(
    declaration: ts.VariableDeclaration,
    target: TsScope,
    nearest: TsScope,
    isExported: boolean
  ): void {
    if (ts.isIdentifier(declaration.name)) {
      this.bindLocal(declaration, declaration.name.text, TsBoundKind.VariableDeclaration, target,
        declaration, new Set([TsDeclarationSpace.VALUE]), isExported);
    } else {
      // A binding pattern declares symbols whose declaration node is a
      // BindingElement, NOT a VariableDeclaration. tsc's symbol partition says
      // so, and the distinction is why destructured names are bound with their
      // own kind rather than folded in.
      this.bindBindingName(declaration.name, declaration, TsBoundKind.BindingElement, target,
        target, isExported);
    }
    if (declaration.initializer) {
      this.visit(declaration.initializer, nearest, nearest, nearest);
    }
  }

  private bindBindingName(
    name: ts.BindingName,
    owner: ts.Node,
    kind: TsBoundKind,
    target: TsScope,
    nearest: TsScope,
    isExported: boolean
  ): void {
    if (ts.isIdentifier(name)) {
      this.bindLocal(owner, name.text, kind, target, kind === TsBoundKind.Parameter ? owner : owner,
        new Set([TsDeclarationSpace.VALUE]), isExported);
      return;
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }
      this.bindBindingName(element.name, element, TsBoundKind.BindingElement, target, nearest,
        isExported);
      if (element.initializer) {
        this.visit(element.initializer, nearest, nearest, nearest);
      }
    }
  }

  private bindImport(node: ts.Node, blockScope: TsScope): void {
    if (ts.isImportEqualsDeclaration(node)) {
      this.bindLocal(node, node.name.text, TsBoundKind.ImportBinding, blockScope, node, new Set(),
        hasModifier(node, ts.SyntaxKind.ExportKeyword));
      return;
    }
    if (!ts.isImportDeclaration(node) || !node.importClause) {
      return;
    }
    const clause = node.importClause;
    if (clause.name) {
      this.bindLocal(clause, clause.name.text, TsBoundKind.ImportBinding, blockScope, clause,
        new Set(), false);
    }
    const bindings = clause.namedBindings;
    if (!bindings) {
      return;
    }
    if (ts.isNamespaceImport(bindings)) {
      this.bindLocal(bindings, bindings.name.text, TsBoundKind.ImportBinding, blockScope, bindings,
        new Set(), false);
      return;
    }
    for (const specifier of bindings.elements) {
      this.bindLocal(specifier, specifier.name.text, TsBoundKind.ImportBinding, blockScope,
        specifier, new Set(), false);
    }
  }

  private bindNamed(
    node: ts.NamedDeclaration,
    kind: TsBoundKind,
    target: TsScope,
    spaces: ReadonlySet<TsDeclarationSpace>
  ): BoundDeclaration | undefined {
    const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
    // `export default class {}` binds under the binder's own reserved name.
    // This is `InternalSymbolName.Default`, not an invention of this parser.
    const name = isDefault
      ? TS_DEFAULT_EXPORT_NAME
      : node.name && ts.isIdentifier(node.name)
        ? node.name.text
        : node.name && ts.isStringLiteral(node.name)
          ? node.name.text
          : '';
    if (name === '') {
      return undefined;
    }
    return this.bindLocal(node, name, kind, target, node, spaces, isExported);
  }

  /**
   * The one global table of ambient module declarations.
   *
   * Ambient modules do not live in the declaring file's scope — `declare module
   * "*.svg"` in two files is one symbol — so they are bound under `GLOBAL`
   * regardless of which file or which module scope they were written in.
   */
  private globalAmbientScope(): TsScope {
    if (!this.ambientScope) {
      this.ambientScope = this.makeScope(
        this.sf,
        TsScopeKind.AMBIENT_MODULE,
        undefined,
        true,
        true,
        TS_MERGE_SCOPE.GLOBAL,
        TS_MERGE_SCOPE.GLOBAL,
        ''
      );
    }
    return this.ambientScope;
  }

  private bindLocal(
    node: ts.Node,
    name: string,
    kind: TsBoundKind,
    target: TsScope,
    siteNode: ts.Node,
    spaces: ReadonlySet<TsDeclarationSpace>,
    isExported: boolean,
    preEscaped = false
  ): BoundDeclaration {
    const escapedName = preEscaped ? name : escapeName(name);
    // Which of the scope's two keys applies is decided by `export`, because in
    // a module or a namespace exported and local declarations of one name are
    // two symbols. tsc rejects mixing them (TS2395), which is the evidence.
    const mergeScopeKey = isExported && target.exportedMergeScopeKey !== ''
      ? target.exportedMergeScopeKey
      : target.localMergeScopeKey !== ''
        ? target.localMergeScopeKey
        : target.exportedMergeScopeKey;
    const binding: BoundDeclaration = {
      name,
      escapedName,
      kind,
      node,
      siteNode,
      mergeScopeKey,
      declarationGroupKey: declarationGroupKeyFor(mergeScopeKey, escapedName),
      declarationSpaces: spaces,
      isExported,
      scope: target,
    };
    const table = kind === TsBoundKind.FunctionDeclaration
      || (kind === TsBoundKind.VariableDeclaration && isVarDeclaration(node))
      ? target.varTable
      : target.blockTable;
    const existing = table.get(escapedName);
    if (existing) {
      existing.push(binding);
    } else {
      table.set(escapedName, [binding]);
    }
    this.bindingByNode.set(nodeId(node, this.sf), binding);
    this.declarationsInOrder.push(binding);
    return binding;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isVarDeclaration(node: ts.Node): boolean {
  if (!ts.isVariableDeclaration(node)) {
    return false;
  }
  const list = node.parent;
  if (!list || !ts.isVariableDeclarationList(list)) {
    return false;
  }
  return (list.flags & ts.NodeFlags.BlockScoped) === 0;
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = (node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
  if (!modifiers) {
    return false;
  }
  for (const modifier of modifiers) {
    if (modifier.kind === kind) {
      return true;
    }
  }
  return false;
}

/**
 * TypeScript's `escapeLeadingUnderscores`.
 *
 * A name beginning with two underscores gets a third in the symbol table, so
 * `__proto__` cannot collide with `Object.prototype.__proto__`. Reproducing it
 * matters because `escapedName` is half of the merge key: getting it wrong
 * splits or joins symbols in exactly the cases the escape exists to separate.
 */
/**
 * tsc's `InternalSymbolName.Global` — the symbol every `declare global` block
 * declares. Reproduced verbatim so N blocks across N files form one group.
 */
export const TS_GLOBAL_SYMBOL_NAME = '__global';

export function escapeName(name: string): string {
  return name.length >= 2 && name.charCodeAt(0) === 95 && name.charCodeAt(1) === 95
    ? `_${name}`
    : name;
}

/**
 * Is this namespace INSTANTIATED — does it exist at runtime?
 *
 * `namespace N { interface I {} }` is erased entirely: it occupies the NAMESPACE
 * space but not VALUE. A parser that treats every namespace as a value invents a
 * runtime entity for the erased ones; one that treats none as a value loses the
 * real ones. tsc calls this `ModuleInstantiationState` and decides it from the
 * body alone, which is why it is decidable here.
 */
export function isInstantiatedNamespace(node: ts.ModuleDeclaration): boolean {
  const body = node.body;
  if (!body) {
    return false;
  }
  if (ts.isModuleDeclaration(body)) {
    return isInstantiatedNamespace(body);
  }
  if (!ts.isModuleBlock(body)) {
    return false;
  }
  for (const statement of body.statements) {
    switch (statement.kind) {
      case ts.SyntaxKind.InterfaceDeclaration:
      case ts.SyntaxKind.TypeAliasDeclaration: {
        continue;
      }
      case ts.SyntaxKind.ModuleDeclaration: {
        if (isInstantiatedNamespace(statement as ts.ModuleDeclaration)) {
          return true;
        }
        continue;
      }
      default: {
        return true;
      }
    }
  }
  return false;
}

/** The member's name as written, or `undefined` for a computed or unnamed member. */
export function memberName(member: ts.Node): string | undefined {
  const name = (member as { name?: ts.PropertyName }).name;
  if (!name) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}
