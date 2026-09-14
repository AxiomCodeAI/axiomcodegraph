import * as path from 'path';

import * as ts from 'typescript';

import { JS_DEFAULT_EXPORT_NAME } from '@/constants/javascript-constants';
import { JsExportRegistry } from '@/analysis-types/javascript/JsExportRegistry';
import { JsExpressionRegistry } from '@/analysis-types/javascript/JsExpressionRegistry';
import { JsImportRegistry } from '@/analysis-types/javascript/JsImportRegistry';
import {
  JsExportForm,
  JsExportTargetKind,
  JsExportedValueKind,
} from '@/enums/javascript/exports';
import {
  JsEdgeBearer,
  JsImportBindingForm,
  JsImportForm,
  JsImportResolutionOutcome,
  JsSpecifierKind,
} from '@/enums/javascript/imports';
import { ScopeBuildResult } from '@/parsers/javascript/extractors/js-scope-builder';
import { JsScopeNode, nodeKey } from '@/parsers/javascript/extractors/js-symbol-table';
import {
  enclosingVariableDeclaration,
  isDynamicImportCall,
  isNodeBuiltinSpecifier,
  isRequireCall,
  pointOf,
} from '@/utils/javascript';

/**
 * `js_import` and `js_export`, minted in a **second pass from expression rows**.
 *
 * ## CommonJS inverts the build order, and this file is where it happens
 *
 * §1 of `BUILDING-A-PARSER.md` puts expressions last because they reference
 * everything else. In JavaScript **83.6% of module edges are expression-borne**:
 * `require('./x')` is a call and `module.exports = X` is an assignment. So the
 * module graph depends partly on the relation that is built last, and these two
 * relations are built after it.
 *
 * That is the single finding that made JavaScript its own front end. Routing
 * expression-minted rows into `ts_import` would have inverted the build order
 * for the whole TypeScript front end, to serve a language whose every module
 * edge is a top-level declaration.
 *
 * ## The 1:1 is structural, not asserted
 *
 * `isModuleEdge` on `js_expression` is **set here**, by the pass that mints the
 * edge row, and `sourceExpressionLinkHash` points back at the expression. Gate
 * 7.3.1 then reads: every expression with the flag is pointed at by exactly one
 * edge row. A second pass that double-mints **doubles** the module-edge count
 * rather than colliding, and nothing else would report it.
 *
 * ## Nothing reaches THROUGH an edge
 *
 * The specifier is recorded **as written**, with `specifierKind` and
 * `resolvedFilePath` from `ts.resolveModuleName` — a pure function of a
 * specifier, options and a host, needing no Program and no installed
 * `node_modules` for its answer to be honest. Nothing here names what
 * `./router` exports. `resolvedModuleLinkHash` is tier 3 and has no setter:
 * turning a path string into a link is cross-file following, which is the
 * engine's work and which TypeScript wrote once and then deleted.
 */
export interface ModuleEdgeExtractionOptions {
  readonly sourceFile: ts.SourceFile;
  readonly binder: ScopeBuildResult;
  readonly absoluteFilePath: string;
  readonly moduleHash: string;
  readonly serviceVersionLinkHash: string;
  readonly compilerOptions: ts.CompilerOptions;
  readonly serviceVersion: string;
  readonly hashOfScope: (scope: JsScopeNode) => string;
  readonly expressionRowByNode: ReadonlyMap<string, JsExpressionRegistry>;
  readonly rootHashByNode: ReadonlyMap<string, string>;
  /** `nodeKey` -> `js_method` hash, so a nested `require` names its owner. */
  readonly methodHashByNode: ReadonlyMap<string, string>;
  /** js_type hash by declaring class node — the target of `export [default] class`, by identity. */
  readonly typeHashByNode: ReadonlyMap<string, string>;
  readonly moduleInitMethodHash: string;
  /** Project-relative path for an absolute one, so `resolvedFilePath` joins. */
  readonly toProjectRelative: (absolutePath: string) => string;
  /** Absolute paths the analysis covers, for `RESOLVED_PROJECT`. */
  readonly projectModuleHashes: ReadonlyMap<string, string>;
  /** Declarations by name, so an export can point at what it exports. */
  /**
   * Every declaration under a name, in source order, with its offset.
   *
   * A LIST because a name is not an identity — see the sweep that found six
   * indexes making that assumption. The export picks by position.
   */
  readonly declarationTargetByName: ReadonlyMap<
    string, ReadonlyArray<{ kind: JsExportTargetKind; hash: string; start: number }>
  >;
}

export interface ModuleEdgeResult {
  readonly imports: readonly JsImportRegistry[];
  readonly exports: readonly JsExportRegistry[];
  /** Local name -> the import that binds it, for the call-site hop. */
  /**
   * Local name -> the imports that bind it, in source order.
   *
   * **A list, not a single row.** It was `Map<string, JsImportRegistry>` and
   * last-wins, so a module that binds a name twice — `const paint =
   * require('paint')` in two branches, `pad` in two functions — gave every
   * reference to the LAST binding. 57 colliding names over 4,561 files, 92
   * shadowed imports, a figure js-corpus reached independently by measuring
   * order bias rather than shadow counting.
   *
   * The caller picks by POSITION through {@link importBinding}, because which
   * import a name refers to is decided by where the reference is.
   */
  readonly importsByLocalName: ReadonlyMap<string, readonly {
    row: JsImportRegistry; start: number;
  }[]>;
  /**
   * The import binding `name` refers to AT this offset.
   *
   * Nearest-preceding, falling back to the first: a reference above every
   * binding is the hoisting case and still means the one that follows.
   */
  readonly importBinding: (name: string, at: number) => JsImportRegistry | undefined;
  /** The import that binds THIS Identifier node, by identity. See the field's doc. */
  readonly importByBindingNode: ReadonlyMap<string, JsImportRegistry>;
  /**
   * Mints the `js_import` row for a JSDoc `import("./x").Y` (§3.8.1). Called
   * after the JSDoc pass, which is what finds the nodes; the row joins the
   * `imports` list, so it is written with every other edge.
   */
  readonly emitJsDocImportType: (node: ts.ImportTypeNode) => JsImportRegistry | undefined;
}

export function extractModuleEdges(
  options: ModuleEdgeExtractionOptions
): ModuleEdgeResult {
  return new JsModuleEdgeExtractor(options).run();
}

class JsModuleEdgeExtractor {
  private readonly options: ModuleEdgeExtractionOptions;
  private readonly sourceFile: ts.SourceFile;
  private readonly imports: JsImportRegistry[] = [];
  private readonly exports: JsExportRegistry[] = [];
  private readonly importsByLocalName = new Map<string, Array<{
    row: JsImportRegistry; start: number;
  }>>();
  /**
   * Import row by the key of the Identifier it BINDS.
   *
   * ## The reverse link was keyed on a name, and got WORSE when the forward
   * one was fixed
   *
   * `boundVariableLinkHash` was set by walking every variable, resolving its
   * NAME to an import, and writing the variable back onto that import. A local
   * `const paint = …` inside a function resolved to the module-level
   * `require('paint')` — because that is the nearest preceding import of that
   * name — and then overwrote the import's reverse link with itself. Both
   * directions wrong. Making the forward lookup position-aware let MORE shadows
   * find the import: 72 wrong targets became 152. Sixth instance of the
   * name-keyed class, and the only one that went backwards.
   *
   * A variable is bound BY an import only if it IS the import's binding: the
   * same Identifier node. The binder keys every import binding on that node
   * (`clause.name`, `bindings.name`, `element.name`, `declaration.name`), the
   * variable row is keyed on the same node, and this map joins them by identity.
   */
  private readonly importByBindingNode = new Map<string, JsImportRegistry>();
  /** Every require/import call already turned into an import row, by node key. */
  private readonly handledCalls = new Set<string>();
  /**
   * Local names bound to a `createRequire(...)` result.
   *
   * A call through one of these is a real module edge spelled as an ordinary
   * call on a local name, so matching the identifier `require` alone sees a call
   * to an unknown function and emits nothing.
   */
  private readonly createdRequireNames = new Set<string>();

  constructor(options: ModuleEdgeExtractionOptions) {
    this.options = options;
    this.sourceFile = options.sourceFile;
  }

  run(): ModuleEdgeResult {
    // Declaration-borne edges first — `import`/`export` statements, which only
    // ever sit at the top level. 16.4% of edges, and the half TypeScript's
    // extractors already model.
    for (const statement of this.sourceFile.statements) {
      this.visitDeclarationEdge(statement);
    }

    // `createRequire` bindings first, in their own pass: a call through the name
    // it binds is a module edge, and in a file that calls before it binds — legal
    // where the binding is hoisted — a single ordered walk would miss it.
    this.collectCreatedRequireNames(this.sourceFile);

    // Expression-borne edges second, by a RECURSIVE walk. A scan of
    // `sourceFile.statements` — which is what every TypeScript module-edge
    // extractor does, because every TypeScript module edge is a top-level
    // declaration — misses one require in seven: 1,227 of 9,055 measured calls
    // are not top level, 1,048 in a function body and 179 in a block.
    this.walkExpressionEdges(this.sourceFile);

    this.markOverwrites();
    return {
      imports: this.imports,
      exports: this.exports,
      importsByLocalName: this.importsByLocalName,
      importByBindingNode: this.importByBindingNode,
      emitJsDocImportType: (node) => this.emitJsDocImportType(node),
      importBinding: (name, at) => {
        const bound = this.importsByLocalName.get(name);
        if (bound === undefined || bound.length === 0) {
          return undefined;
        }
        let chosen = bound[0]!;
        for (const candidate of bound) {
          if (candidate.start <= at) {
            chosen = candidate;
          }
        }
        return chosen.row;
      },
    };
  }

  // -------------------------------------------------------------------------
  // declaration-borne
  // -------------------------------------------------------------------------

  private visitDeclarationEdge(statement: ts.Statement): void {
    if (ts.isImportDeclaration(statement)) {
      this.emitImportDeclaration(statement);
      return;
    }
    if (ts.isExportDeclaration(statement)) {
      this.emitExportDeclaration(statement);
      return;
    }
    if (ts.isExportAssignment(statement)) {
      this.emitExportDefault(statement);
      return;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      // `import x = require('y')`. TypeScript syntax that `ts.createSourceFile`
      // will parse out of a `.js` file if it meets it, so a file carrying one
      // produces a module edge rather than a silent nothing.
      const reference = statement.moduleReference;
      this.emitImport({
        node: statement,
        specifier: ts.isExternalModuleReference(reference)
          && ts.isStringLiteralLike(reference.expression)
          ? reference.expression.text
          : reference.getText(this.sourceFile),
        importForm: JsImportForm.IMPORT_EQUALS,
        bindingForm: JsImportBindingForm.NAMESPACE,
        importedName: '',
        localName: statement.name.text,
        edgeBearer: JsEdgeBearer.DECLARATION,
        sourceExpression: undefined,
      });
      return;
    }
    if (hasExportModifier(statement)) {
      this.emitExportedDeclaration(statement);
      return;
    }
  }

  private emitImportDeclaration(node: ts.ImportDeclaration): void {
    const specifier = ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : '';
    const clause = node.importClause;
    if (clause === undefined) {
      // `import './polyfill'` binds nothing and is still a real edge: the
      // module runs and its side effects happen. TypeScript had this defect —
      // an empty import recorded no module edge, so a package imported only for
      // its ambient declarations could not be staged.
      this.emitImport({
        node,
        specifier,
        importForm: JsImportForm.IMPORT_DECLARATION,
        bindingForm: JsImportBindingForm.SIDE_EFFECT_ONLY,
        importedName: '',
        localName: '',
        edgeBearer: JsEdgeBearer.DECLARATION,
        sourceExpression: undefined,
      });
      return;
    }
    if (clause.name !== undefined) {
      this.emitImport({
        node,
        specifier,
        importForm: JsImportForm.IMPORT_DECLARATION,
        bindingForm: JsImportBindingForm.DEFAULT,
        importedName: 'default',
        localName: clause.name.text,
        bindingName: clause.name,
        edgeBearer: JsEdgeBearer.DECLARATION,
        sourceExpression: undefined,
      });
    }
    const bindings = clause.namedBindings;
    if (bindings === undefined) {
      return;
    }
    if (ts.isNamespaceImport(bindings)) {
      this.emitImport({
        node,
        specifier,
        importForm: JsImportForm.IMPORT_DECLARATION,
        bindingForm: JsImportBindingForm.NAMESPACE,
        importedName: '',
        localName: bindings.name.text,
        bindingName: bindings.name,
        edgeBearer: JsEdgeBearer.DECLARATION,
        sourceExpression: undefined,
      });
      return;
    }
    for (const element of bindings.elements) {
      this.emitImport({
        node: element,
        specifier,
        importForm: JsImportForm.IMPORT_DECLARATION,
        bindingForm: JsImportBindingForm.NAMED,
        importedName: (element.propertyName ?? element.name).text,
        localName: element.name.text,
        bindingName: element.name,
        edgeBearer: JsEdgeBearer.DECLARATION,
        sourceExpression: undefined,
      });
    }
  }

  private emitExportDeclaration(node: ts.ExportDeclaration): void {
    const specifier = node.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : '';
    if (node.exportClause === undefined) {
      // `export * from './y'` — an import and an export in one statement.
      const importRow = specifier === '' ? undefined : this.emitImport({
        node,
        specifier,
        importForm: JsImportForm.IMPORT_DECLARATION,
        bindingForm: JsImportBindingForm.NAMESPACE,
        importedName: '',
        localName: '',
        edgeBearer: JsEdgeBearer.DECLARATION,
        sourceExpression: undefined,
      });
      this.emitExport({
        node,
        exportedName: '*',
        localName: '',
        exportForm: JsExportForm.EXPORT_ALL,
        exportedValueKind: JsExportedValueKind.OTHER,
        edgeBearer: JsEdgeBearer.DECLARATION,
        isReExport: true,
        reExportSpecifier: specifier,
        reExportImport: importRow,
        sourceExpression: undefined,
      });
      return;
    }
    if (ts.isNamespaceExport(node.exportClause)) {
      // `export * as ns from './y'` — the whole module, re-exported under ONE
      // name. Its clause is a NamespaceExport, which is neither `undefined`
      // (bare `export *`) nor NamedExports (`export { a as b }`), so it fell
      // between the two branches and emitted NOTHING: one framework's seven-line
      // namespace re-export module recorded zero exports while both other forms
      // beside it emitted.
      //
      // EXPORT_ALL is the right form — an import and an export in one
      // statement — and `exportedName` carries what distinguishes it from the
      // bare case. No local binding is minted: `ns` is not in scope inside this
      // module, only in whoever imports it.
      const importRow = specifier === '' ? undefined : this.emitImport({
        node,
        specifier,
        importForm: JsImportForm.IMPORT_DECLARATION,
        bindingForm: JsImportBindingForm.NAMESPACE,
        importedName: '',
        localName: '',
        edgeBearer: JsEdgeBearer.DECLARATION,
        sourceExpression: undefined,
      });
      this.emitExport({
        node,
        exportedName: node.exportClause.name.text,
        localName: '',
        exportForm: JsExportForm.EXPORT_ALL,
        exportedValueKind: JsExportedValueKind.OTHER,
        edgeBearer: JsEdgeBearer.DECLARATION,
        isReExport: true,
        reExportSpecifier: specifier,
        reExportImport: importRow,
        sourceExpression: undefined,
      });
      return;
    }
    if (ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        // `export { a as b } from './x'` and `export { default } from './x'`
        // are an import and an export in one statement, exactly as
        // `export *` is — but only `export *` minted the import row and set
        // reExportImportLinkHash, so every other re-export form yielded
        // nothing on the importing side: the engine's join from the export
        // to the source module had no import to follow (engine #483). One
        // import row per element, binding NOTHING locally (the name is not
        // in this module's scope), importedName the source-side name.
        const importRow = specifier === '' ? undefined : this.emitImport({
          node: element,
          specifier,
          importForm: JsImportForm.IMPORT_DECLARATION,
          bindingForm: JsImportBindingForm.NO_LOCAL_BINDING,
          importedName: local,
          localName: '',
          edgeBearer: JsEdgeBearer.DECLARATION,
          sourceExpression: undefined,
        });
        this.emitExport({
          node: element,
          exportedName: element.name.text,
          localName: local,
          exportForm: JsExportForm.EXPORT_DECLARATION,
          exportedValueKind: JsExportedValueKind.IDENTIFIER,
          edgeBearer: JsEdgeBearer.DECLARATION,
          isReExport: specifier !== '',
          reExportSpecifier: specifier,
          reExportImport: importRow,
          sourceExpression: undefined,
        });
      }
    }
  }

  private emitExportDefault(node: ts.ExportAssignment): void {
    this.emitExport({
      node,
      exportedName: JS_DEFAULT_EXPORT_NAME,
      localName: ts.isIdentifier(node.expression) ? node.expression.text : '',
      exportForm: JsExportForm.EXPORT_DEFAULT,
      exportedValueKind: valueKindOf(node.expression),
      edgeBearer: JsEdgeBearer.DECLARATION,
      isReExport: false,
      reExportSpecifier: '',
      reExportImport: undefined,
      sourceExpression: node.expression,
    });
  }

  private emitExportedDeclaration(statement: ts.Statement): void {
    // `export default function named() {}` / `export default class K {}`:
    // the DEFAULT modifier decides the exported name, not whether the
    // declaration has one. Only the name was consulted, so a named default
    // export was emitted under its local name — indistinguishable from
    // `export function named()`, and `import x from` found no `default`
    // (#176: 16 of 16 on one ESM package). The anonymous form and the
    // expression form were already `default`.
    const isDefault = (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
      && (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Default) !== 0;
    // The target BY NODE for a declaration export: the class or function IS
    // the statement, so its row is known by identity and no name lookup is
    // needed — and for `export default class extends Base {}` there is no
    // name to look up at all. That row went out as EXPRESSION_VALUE with an
    // empty target, so a default import held nothing (engine #484); the
    // grammar allows exactly one anonymous class declaration per module.
    const declared = ts.isClassDeclaration(statement)
      ? { kind: JsExportTargetKind.TYPE, hash: this.options.typeHashByNode.get(nodeKey(statement)) }
      : ts.isFunctionDeclaration(statement)
        ? { kind: JsExportTargetKind.METHOD, hash: this.options.methodHashByNode.get(nodeKey(statement)) }
        : undefined;
    for (const name of exportedNamesOf(statement)) {
      this.emitExport({
        node: statement,
        exportedName: isDefault ? JS_DEFAULT_EXPORT_NAME : name,
        localName: name,
        declaredTarget: declared?.hash === undefined ? undefined : { kind: declared.kind, hash: declared.hash },
        exportForm: JsExportForm.EXPORT_DECLARATION,
        exportedValueKind: declaredValueKindOf(statement),
        edgeBearer: JsEdgeBearer.DECLARATION,
        isReExport: false,
        reExportSpecifier: '',
        reExportImport: undefined,
        sourceExpression: undefined,
      });
    }
  }

  // -------------------------------------------------------------------------
  // expression-borne — 83.6% of edges
  // -------------------------------------------------------------------------

  /**
   * A RECURSIVE walk, because a module edge is not necessarily at the top of
   * the file.
   *
   * `require` inside an `if` inside a function body is a real module edge and
   * 13.6% of them are exactly that. A statement-list scan never sees one.
   */
  private walkExpressionEdges(node: ts.Node): void {
    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      this.visitExportAssignment(node);
    }
    if (ts.isCallExpression(node)) {
      this.visitEdgeCall(node);
    }
    ts.forEachChild(node, (child) => {
      this.walkExpressionEdges(child);
    });
  }

  /**
   * `module.exports = X`, `module.exports.x = …`, `exports.x = …`.
   *
   * `module.exports = require('./y')` is handled here and produces **two** rows
   * in two relations, joined by `reExportImportLinkHash` — 81 measured, and one
   * line of source that is simultaneously an import and an export. Dropping
   * either half loses a real edge.
   */
  private visitExportAssignment(node: ts.BinaryExpression): void {
    const target = node.left;
    if (!ts.isPropertyAccessExpression(target)) {
      return;
    }
    const form = exportFormOf(target);
    if (form === undefined) {
      return;
    }
    const exportedName = form === JsExportForm.MODULE_EXPORTS_ASSIGNMENT
      ? JS_DEFAULT_EXPORT_NAME
      : target.name.text;

    // The re-export case: the right-hand side is itself a module edge.
    let reExportImport: JsImportRegistry | undefined;
    const value = node.right;
    if (ts.isCallExpression(value) && isRequireCall(value)) {
      reExportImport = this.emitRequire(value, {
        bindingForm: JsImportBindingForm.NAMESPACE,
        importedName: '',
        localName: '',
      });
    }

    this.emitExport({
      node,
      exportedName,
      localName: ts.isIdentifier(value) ? value.text : '',
      exportForm: form,
      exportedValueKind: reExportImport !== undefined
        ? JsExportedValueKind.REQUIRE_REEXPORT
        : valueKindOf(value),
      edgeBearer: JsEdgeBearer.EXPRESSION,
      isReExport: reExportImport !== undefined,
      reExportSpecifier: reExportImport?.specifier ?? '',
      reExportImport,
      sourceExpression: node,
    });
  }

  private collectCreatedRequireNames(node: ts.Node): void {
    if (ts.isCallExpression(node) && isCreateRequireCall(node)) {
      const declaration = enclosingVariableDeclaration(node);
      if (declaration !== undefined && ts.isIdentifier(declaration.name)) {
        this.createdRequireNames.add(declaration.name.text);
      }
    }
    ts.forEachChild(node, (child) => {
      this.collectCreatedRequireNames(child);
    });
  }

  private visitEdgeCall(node: ts.CallExpression): void {
    if (this.handledCalls.has(nodeKey(node))) {
      return;
    }
    if (isRequireCall(node) || this.isCreatedRequireCall(node)) {
      this.emitRequireWithBinding(node);
      return;
    }
    // `const require = createRequire(import.meta.url)` — how an ES module
    // reaches CommonJS. The edge is the requires made THROUGH the resulting
    // function, and the binding is what makes them findable, so the name it
    // binds is remembered here and matched in `isCreatedRequireCall`.
    if (isCreateRequireCall(node)) {
      const declaration = enclosingVariableDeclaration(node);
      if (declaration !== undefined && ts.isIdentifier(declaration.name)) {
        this.createdRequireNames.add(declaration.name.text);
      }
      return;
    }
    if (isDynamicImportCall(node)) {
      this.emitImport({
        node,
        specifier: literalSpecifierOf(node) ?? '',
        importForm: JsImportForm.DYNAMIC_IMPORT,
        bindingForm: JsImportBindingForm.NAMESPACE,
        importedName: '',
        localName: '',
        edgeBearer: JsEdgeBearer.EXPRESSION,
        sourceExpression: node,
      });
      return;
    }
    // `Object.defineProperty(exports, 'x', …)` — what transpilers emit, and the
    // only lazy export form: the value is computed on first read.
    if (isDefinePropertyOnExports(node)) {
      const nameArgument = node.arguments[1];
      this.emitExport({
        node,
        exportedName: nameArgument !== undefined && ts.isStringLiteralLike(nameArgument)
          ? nameArgument.text
          : '',
        localName: '',
        exportForm: JsExportForm.OBJECT_DEFINE_PROPERTY,
        exportedValueKind: JsExportedValueKind.OTHER,
        edgeBearer: JsEdgeBearer.EXPRESSION,
        isReExport: false,
        reExportSpecifier: '',
        reExportImport: undefined,
        sourceExpression: node,
      });
    }
  }

  /**
   * A `require()` together with whatever it binds.
   *
   * Four binding shapes, and the destructured one is why `startColumn` is in
   * `js_import`'s primary key: `const { a, b } = require('x')` produces two rows
   * on one line with one specifier, and without the column they collide **by
   * doubling, not by erroring**.
   */
  private emitRequireWithBinding(call: ts.CallExpression): void {
    const declaration = enclosingVariableDeclaration(call);
    if (declaration === undefined) {
      // A bare `require('./polyfill')` — no binding, and still a real edge.
      this.emitRequire(call, {
        bindingForm: JsImportBindingForm.SIDE_EFFECT_ONLY,
        importedName: '',
        localName: '',
      });
      return;
    }
    // `const x = require('y').Thing` — a NAMED import through a member access,
    // which is how CommonJS pulls one export out.
    const initializer = declaration.initializer;
    const throughMember = initializer !== undefined
      && ts.isPropertyAccessExpression(initializer)
      && initializer.expression === call;

    if (ts.isIdentifier(declaration.name)) {
      this.emitRequire(call, {
        bindingForm: throughMember
          ? JsImportBindingForm.NAMED
          : JsImportBindingForm.NAMESPACE,
        importedName: throughMember
          ? (initializer as ts.PropertyAccessExpression).name.text
          : '',
        localName: declaration.name.text,
        bindingName: declaration.name,
      });
      return;
    }
    if (ts.isObjectBindingPattern(declaration.name)) {
      this.emitDestructuredRequire(call, declaration.name, '');
      return;
    }
    this.emitRequire(call, {
      bindingForm: JsImportBindingForm.NAMESPACE,
      importedName: '',
      localName: '',
    });
  }

  /**
   * One import row per name an object pattern binds, however deeply nested.
   *
   * ## A nested pattern dropped the edge entirely, and said nothing
   *
   * `const { codes: { ERR_A, ERR_B } } = require('./errors');` produced ZERO
   * js_import rows and ZERO js_parse_gap rows. Not a degraded edge — an ABSENT
   * one, with nothing recording that anything had been dropped, which §9 says is
   * the thing a parser may never do.
   *
   * The cause was a `continue` on `!ts.isIdentifier(element.name)`. A nested
   * pattern's name IS a pattern, so the branch written to skip an unsupported
   * element skipped an entire subtree of supported ones. Every flat form in the
   * same file worked: `{a, b}`, `{join: j}`, `{m = 1}`, `[f]`, `{k, ...r}`.
   *
   * 72 of 13,190 require edges corpus-wide, 68 of them in one standard-library tree, which uses
   * exactly this shape for its error tables.
   *
   * ## `importedName` carries the PATH, because the path is what is imported
   *
   * `ERR_A` alone would name something the module does not export. The module
   * exports `codes`, and `ERR_A` is a property of it, so the imported name is
   * `codes.ERR_A` — the same thing the single-level `require('x').Thing` form
   * already records as `Thing`, one level deeper.
   *
   * An ARRAY pattern is deliberately not recursed into: its elements are
   * positional, and a module does not export an index. That form already emits
   * its row through the namespace branch.
   */
  private emitDestructuredRequire(
    call: ts.CallExpression,
    pattern: ts.ObjectBindingPattern,
    prefix: string
  ): void {
    for (const element of pattern.elements) {
      const key = element.propertyName !== undefined
        && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : ts.isIdentifier(element.name) ? element.name.text : '';
      if (ts.isObjectBindingPattern(element.name)) {
        this.emitDestructuredRequire(call, element.name,
          prefix === '' ? key : `${prefix}.${key}`);
        continue;
      }
      if (!ts.isIdentifier(element.name)) {
        continue;
      }
      this.emitRequire(call, {
        bindingForm: JsImportBindingForm.DESTRUCTURED,
        importedName: prefix === '' ? key : `${prefix}.${key}`,
        localName: element.name.text,
        bindingName: element.name,
        // The NAME node, not the call: one row per bound name, and each needs
        // its own column so the two on one line do not collide.
        positionNode: element.name,
      });
    }
  }

  /** A call through a name bound by `createRequire`. */
  private isCreatedRequireCall(node: ts.CallExpression): boolean {
    return ts.isIdentifier(node.expression)
      && this.createdRequireNames.has(node.expression.text)
      && node.arguments.length >= 1;
  }

  private emitRequire(
    call: ts.CallExpression,
    binding: {
      bindingForm: JsImportBindingForm;
      importedName: string;
      localName: string;
      positionNode?: ts.Node;
      bindingName?: ts.Identifier;
    }
  ): JsImportRegistry | undefined {
    this.handledCalls.add(nodeKey(call));
    const specifier = literalSpecifierOf(call);
    return this.emitImport({
      node: binding.positionNode ?? call,
      bindingName: binding.bindingName,
      specifier: specifier ?? textOfFirstArgument(call, this.sourceFile),
      specifierKind: specifier !== undefined
        ? JsSpecifierKind.STRING_LITERAL
        : isTemplateSpecifier(call)
          ? JsSpecifierKind.TEMPLATE
          : JsSpecifierKind.NON_LITERAL,
      importForm: this.isCreatedRequireCall(call)
        ? JsImportForm.CREATE_REQUIRE
        : JsImportForm.REQUIRE_CALL,
      bindingForm: binding.bindingForm,
      importedName: binding.importedName,
      localName: binding.localName,
      edgeBearer: JsEdgeBearer.EXPRESSION,
      sourceExpression: call,
    });
  }

  /**
   * The `js_import` row a JSDoc `import("./x").Y` mints. Schema §3.8.1.
   *
   * One row PER OCCURRENCE — the key carries the position and each type
   * reference links its own. `COMMENT`-borne, `JSDOC_IMPORT_TYPE`,
   * `NO_LOCAL_BINDING`, `isTypeOnly`; the qualifier is `importedName` and
   * nothing is bound locally. Resolved by the same `ts.resolveModuleName` as
   * every runtime specifier, so `resolutionOutcome` is honest on it too.
   * Called from the fact extractor after the JSDoc pass, which is what finds
   * the nodes — the module-edge walk never enters a comment.
   */
  emitJsDocImportType(node: ts.ImportTypeNode): JsImportRegistry | undefined {
    const argument = node.argument;
    const literal = ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)
      ? argument.literal
      : undefined;
    return this.emitImport({
      node,
      specifier: literal?.text ?? argument.getText(this.sourceFile),
      specifierKind: literal === undefined ? JsSpecifierKind.NON_LITERAL : JsSpecifierKind.STRING_LITERAL,
      importForm: JsImportForm.JSDOC_IMPORT_TYPE,
      bindingForm: JsImportBindingForm.NO_LOCAL_BINDING,
      importedName: node.qualifier?.getText(this.sourceFile) ?? '',
      localName: '',
      edgeBearer: JsEdgeBearer.COMMENT,
      sourceExpression: undefined,
      isTypeOnly: true,
    });
  }

  // -------------------------------------------------------------------------
  // row construction
  // -------------------------------------------------------------------------

  private emitImport(init: {
    node: ts.Node;
    specifier: string;
    specifierKind?: JsSpecifierKind;
    importForm: JsImportForm;
    bindingForm: JsImportBindingForm;
    importedName: string;
    localName: string;
    /** The Identifier this import BINDS, when it binds one — the binder keys on it. */
    bindingName?: ts.Identifier;
    edgeBearer: JsEdgeBearer;
    sourceExpression: ts.Node | undefined;
    /** `true` only for a JSDoc import type (§3.8.1); every runtime edge is false. */
    isTypeOnly?: boolean;
  }): JsImportRegistry | undefined {
    const at = this.positionOf(init.node);
    const specifierKind = init.specifierKind ?? JsSpecifierKind.STRING_LITERAL;
    const resolution = this.resolve(init.specifier, specifierKind);
    const scope = this.scopeAt(init.node);
    const row = new JsImportRegistry({
      specifier: init.specifier,
      specifierKind,
      edgeBearer: init.edgeBearer,
      importForm: init.importForm,
      isTopLevel: isTopLevel(init.sourceExpression ?? init.node),
      isConditional: isConditional(init.sourceExpression ?? init.node),
      bindingForm: init.bindingForm,
      importedName: init.importedName,
      localName: init.localName,
      resolvedFilePath: resolution.filePath,
      resolutionOutcome: resolution.outcome,
      // NOT a parity slot: JavaScript has `import type`, spelled
      // `import("./x").Y` in a comment (§3.14.4). True for that row only.
      isTypeOnly: init.isTypeOnly ?? false,
      ownerScopeLinkHash: this.options.hashOfScope(scope),
      ownerMethodLinkHash: this.enclosingMethodHash(methodWalkStartOf(init.node)),
      ownerModuleLinkHash: this.options.moduleHash,
      startLine: at.startLine,
      startColumn: at.startColumn,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.imports.push(row);
    if (init.bindingName !== undefined) {
      this.importByBindingNode.set(nodeKey(init.bindingName), row);
    }
    if (init.localName !== '') {
      const bound = this.importsByLocalName.get(init.localName) ?? [];
      // The BINDING's own position, which is the node the row was positioned
      // from — one row per bound name, each at its own name node.
      bound.push({ row, start: init.node.getStart(this.sourceFile) });
      bound.sort((a, b) => a.start - b.start);
      this.importsByLocalName.set(init.localName, bound);
    }
    this.linkExpression(init.sourceExpression, row, (hash) => {
      row.setSourceExpressionLinkHash(hash);
    });
    return row;
  }

  private emitExport(init: {
    node: ts.Node;
    exportedName: string;
    localName: string;
    exportForm: JsExportForm;
    exportedValueKind: JsExportedValueKind;
    edgeBearer: JsEdgeBearer;
    isReExport: boolean;
    reExportSpecifier: string;
    reExportImport: JsImportRegistry | undefined;
    sourceExpression: ts.Node | undefined;
    /** The declaration this export IS, by node identity — wins over any name lookup. */
    declaredTarget?: { kind: JsExportTargetKind; hash: string };
  }): void {
    const at = this.positionOf(init.node);
    const scope = this.scopeAt(init.node);
    const row = new JsExportRegistry({
      exportedName: init.exportedName,
      localName: init.localName,
      edgeBearer: init.edgeBearer,
      exportForm: init.exportForm,
      exportedValueKind: init.exportedValueKind,
      isReExport: init.isReExport,
      reExportSpecifier: init.reExportSpecifier,
      isTopLevel: isTopLevel(init.node),
      isConditional: isConditional(init.node),
      targetKind: JsExportTargetKind.EXPRESSION_VALUE,
      ownerScopeLinkHash: this.options.hashOfScope(scope),
      ownerMethodLinkHash: this.enclosingMethodHash(init.node),
      ownerModuleLinkHash: this.options.moduleHash,
      startLine: at.startLine,
      startColumn: at.startColumn,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    if (init.reExportImport !== undefined) {
      row.setReExportImportLinkHash(init.reExportImport.getHash());
    }
    // Same-file one hop: an exported NAME that is also a declaration in this
    // file points at it. Nothing crosses a module boundary.
    // BY LOCAL NAME ONLY. The fallback to `exportedName` when there was no
    // local was a guess, and it guessed wrong: `exports.getAuthor4Token =
    // async (token) => { … }` linked to a `const getAuthor4Token` declared 26
    // lines earlier — a different function that happens to share the name.
    // The exported value is a fresh anonymous arrow; its own row is reachable
    // through sourceExpressionLinkHash and the expression's c32, which is the
    // honest path. 107 exports over the corpus, every one of them pointing at a
    // declaration that was not the thing exported.
    const candidates = init.localName === ''
      ? undefined
      : this.options.declarationTargetByName.get(init.localName);
    // Nearest-preceding WITHIN A KIND, with the kind priority preserved.
    //
    // A name is resolved AT a position — a module declaring `author` twice gave
    // every export the first one. But position alone is not enough, because ONE
    // declaration can appear under several kinds: `function author() {}` mints a
    // js_method AND the js_variable that binds its name, at different offsets.
    // Taking the latest row before the export picked the binding variable over
    // the method, silently changing `targetKind` on every such export.
    //
    // So position disambiguates between declarations of the SAME kind, and the
    // kind priority — TYPE, then METHOD, then VARIABLE — decides between kinds,
    // exactly as the first-wins map did before.
    const exportOffset = init.node.getStart(this.sourceFile);
    const nearest = (
      kind: JsExportTargetKind
    ): { kind: JsExportTargetKind; hash: string; start: number } | undefined => {
      let chosen: { kind: JsExportTargetKind; hash: string; start: number } | undefined;
      for (const candidate of candidates ?? []) {
        if (candidate.kind !== kind) {
          continue;
        }
        if (chosen === undefined
          || (candidate.start <= exportOffset && candidate.start >= chosen.start)) {
          chosen = candidate;
        }
      }
      return chosen;
    };
    const target = init.declaredTarget
      ?? nearest(JsExportTargetKind.TYPE)
      ?? nearest(JsExportTargetKind.METHOD)
      ?? nearest(JsExportTargetKind.VARIABLE);
    if (target !== undefined) {
      row.setTargetKind(target.kind);
      row.setTargetLinkHash(target.hash);
    }
    this.exports.push(row);
    this.linkExpression(init.sourceExpression, row, (hash) => {
      row.setSourceExpressionLinkHash(hash);
    });
  }

  /**
   * Ties an edge row to the expression it was minted from, and flags that
   * expression.
   *
   * Both directions in one place, so they cannot diverge: the expression's
   * `isModuleEdge` and `moduleEdgeLinkHash`, and the edge's
   * `sourceExpressionLinkHash`. Gate 7.3.1 reads exactly this pairing.
   */
  private linkExpression(
    node: ts.Node | undefined,
    edge: { getHash(): string },
    setSource: (hash: string) => void
  ): void {
    if (node === undefined) {
      return;
    }
    const row = this.options.expressionRowByNode.get(nodeKey(node));
    if (row === undefined) {
      return;
    }
    setSource(row.getHash());
    row.setIsModuleEdge(true);
    row.setModuleEdgeLinkHash(edge.getHash());
  }

  /**
   * `overwritesPreviousExport`, set only when the overwrite is UNCONDITIONAL.
   *
   * ```js
   * exports.a = 1;
   * module.exports = { b };   // exports ONLY b. `a` is gone.
   * ```
   *
   * A fact base recording both edges with no ordering tells the engine this
   * module exports `a`, which is false. Suppressing the earlier row loses the
   * fact that the assignment executed. The flag keeps both and lets the engine
   * decide.
   *
   * **The conditional case is deliberately not claimed.** `if (x) module.exports
   * = {}` *may* overwrite, and a boolean that collapses those two cases is
   * asserting a runtime conclusion from syntax — which is the thing this schema
   * is most careful not to do.
   *
   * ## Unconditional is not enough: it must also be TOP LEVEL
   *
   * ```js
   * function installTestDouble(double) { module.exports = double; }  // nothing calls it
   * for (const k of maybeEmpty) { module.exports = { k }; }          // may run zero times
   * ```
   *
   * Neither is syntactically guarded, so both had `isConditional = false`, and
   * both claimed `overwritesPreviousExport = true` — asserting that earlier
   * export edges are **discarded** by an assignment that may never run. That is
   * exactly the runtime conclusion the paragraph above refuses to draw, in a
   * place the recogniser was not looking. Found by `js-fixtures`, on a pair of
   * fixtures written so the two files would differ and which did not.
   *
   * The fix is on THIS column rather than on `isConditional`, deliberately.
   * `isConditional` means *syntactically guarded* and is worth keeping that way;
   * widening it would make every one of the 1,048 measured nested requires
   * conditional and leave it nearly redundant with `!isTopLevel`. What the
   * overwrite claim needs is *does this definitely execute*, which is
   * unconditional **and** top level — two columns a consumer already has.
   */
  private markOverwrites(): void {
    let seenAnyExport = false;
    for (const row of this.exports) {
      if (row.exportForm === JsExportForm.MODULE_EXPORTS_ASSIGNMENT
        && seenAnyExport && !row.isConditional && row.isTopLevel) {
        row.setOverwritesPreviousExport(true);
      }
      seenAnyExport = true;
    }
  }

  // -------------------------------------------------------------------------

  /**
   * `ts.resolveModuleName`, and nothing more.
   *
   * A pure function of a specifier, options and a host. It builds no Program,
   * typechecks nothing, and needs no installed `node_modules` for its answer to
   * be honest — an unresolvable specifier returns `undefined`, which is a
   * correct answer and not a missing one.
   *
   * Environmental unresolution is **named, not hidden and not counted as a
   * parser gap**. Missing `node_modules` accounted for 10,068 of zod's 10,162
   * incomplete hand-offs in TypeScript, and §7 is explicit that reporting those
   * as gaps is wrong and hiding them is also wrong.
   */
  private resolve(
    specifier: string,
    kind: JsSpecifierKind
  ): { filePath: string; outcome: JsImportResolutionOutcome } {
    if (kind !== JsSpecifierKind.STRING_LITERAL) {
      // Unresolvable BY CONSTRUCTION. 17 measured, and the row says so rather
      // than guessing — a guessed module edge is worse than an absent one,
      // because nothing downstream can tell it from a real one.
      return { filePath: '', outcome: JsImportResolutionOutcome.UNRESOLVED_NON_LITERAL };
    }
    if (isNodeBuiltinSpecifier(specifier)) {
      // Not a failure. Calls through a builtin are 15.3-24.4% of all oracle declines,
      // and the target lives in the `lib_*` population rather than anywhere in
      // the repository — which no amount of installing dependencies changes.
      return { filePath: '', outcome: JsImportResolutionOutcome.RESOLVED_BUILTIN };
    }
    const resolved = ts.resolveModuleName(
      specifier,
      this.options.absoluteFilePath,
      this.options.compilerOptions,
      ts.sys
    ).resolvedModule?.resolvedFileName;
    if (resolved === undefined) {
      return { filePath: '', outcome: JsImportResolutionOutcome.UNRESOLVED_MISSING };
    }
    const absolute = path.normalize(resolved);
    if (this.options.projectModuleHashes.has(absolute)) {
      return {
        filePath: this.options.toProjectRelative(absolute),
        outcome: JsImportResolutionOutcome.RESOLVED_PROJECT,
      };
    }
    return {
      filePath: absolute.split(path.sep).join('/'),
      outcome: JsImportResolutionOutcome.RESOLVED_EXTERNAL,
    };
  }

  private enclosingMethodHash(node: ts.Node): string {
    let current: ts.Node | undefined = node;
    while (current !== undefined) {
      const hash = this.options.methodHashByNode.get(nodeKey(current));
      if (hash !== undefined) {
        return hash;
      }
      current = current.parent;
    }
    return this.options.moduleInitMethodHash;
  }

  private scopeAt(node: ts.Node): JsScopeNode {
    let current: ts.Node | undefined = node;
    while (current !== undefined) {
      const scope = this.options.binder.enclosingScopeOf.get(nodeKey(current));
      if (scope !== undefined) {
        return scope;
      }
      current = current.parent;
    }
    return this.options.binder.moduleScope;
  }

  private positionOf(node: ts.Node): { startLine: number; startColumn: number } {
    return pointOf(node, this.sourceFile);
  }
}

// ---------------------------------------------------------------------------

/** `createRequire(import.meta.url)`, however it was imported. */
function isCreateRequireCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
  return name === 'createRequire';
}

function literalSpecifierOf(call: ts.CallExpression): string | undefined {
  const first = call.arguments[0];
  if (first === undefined) {
    return undefined;
  }
  return ts.isStringLiteralLike(first) ? first.text : undefined;
}

function isTemplateSpecifier(call: ts.CallExpression): boolean {
  const first = call.arguments[0];
  // A template's SHAPE is known even though its value is not — a consumer can
  // see the directory being indexed into, which is enough to stage a subtree.
  // A plain NON_LITERAL offers nothing, so the two are separate values.
  return first !== undefined && ts.isTemplateExpression(first);
}

function textOfFirstArgument(call: ts.CallExpression, sourceFile: ts.SourceFile): string {
  const first = call.arguments[0];
  return first === undefined ? '' : first.getText(sourceFile);
}

/** `module.exports`, `module.exports.x`, `exports.x`. */
function exportFormOf(target: ts.PropertyAccessExpression): JsExportForm | undefined {
  if (ts.isIdentifier(target.expression)) {
    if (target.expression.text === 'module' && target.name.text === 'exports') {
      return JsExportForm.MODULE_EXPORTS_ASSIGNMENT;
    }
    if (target.expression.text === 'exports') {
      // `exports.foo = …`. The same edge as `module.exports.foo` through a
      // different alias — and the two stop being equivalent the moment a
      // `module.exports = {}` runs, because `exports` still points at the old
      // object and a later `exports.x = 1` then exports nothing at all.
      return JsExportForm.EXPORTS_MEMBER;
    }
    return undefined;
  }
  if (ts.isPropertyAccessExpression(target.expression)
    && ts.isIdentifier(target.expression.expression)
    && target.expression.expression.text === 'module'
    && target.expression.name.text === 'exports') {
    return JsExportForm.MODULE_EXPORTS_MEMBER;
  }
  return undefined;
}

function isDefinePropertyOnExports(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)
    || call.expression.name.text !== 'defineProperty'
    || call.arguments.length < 2) {
    return false;
  }
  const target = call.arguments[0]!;
  if (ts.isIdentifier(target) && target.text === 'exports') {
    return true;
  }
  return ts.isPropertyAccessExpression(target)
    && ts.isIdentifier(target.expression) && target.expression.text === 'module'
    && target.name.text === 'exports';
}

/**
 * What is on the right-hand side, which is what an importer actually gets.
 *
 * `OBJECT_LITERAL` at 335 measured is the pre-ES6 namespace, and it reaches the
 * fact base as an expression rather than as a `js_type` — treating every object
 * literal as a type is how a fact base acquires 50,000 meaningless types.
 */
function valueKindOf(value: ts.Expression): JsExportedValueKind {
  if (ts.isFunctionExpression(value) || ts.isArrowFunction(value)) {
    return JsExportedValueKind.FUNCTION;
  }
  if (ts.isClassExpression(value)) {
    return JsExportedValueKind.CLASS;
  }
  if (ts.isObjectLiteralExpression(value)) {
    return JsExportedValueKind.OBJECT_LITERAL;
  }
  if (ts.isIdentifier(value)) {
    return JsExportedValueKind.IDENTIFIER;
  }
  return JsExportedValueKind.OTHER;
}

function declaredValueKindOf(statement: ts.Statement): JsExportedValueKind {
  if (ts.isFunctionDeclaration(statement)) {
    return JsExportedValueKind.FUNCTION;
  }
  if (ts.isClassDeclaration(statement)) {
    return JsExportedValueKind.CLASS;
  }
  return JsExportedValueKind.IDENTIFIER;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement)
    && (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    );
}

function exportedNamesOf(statement: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return statement.name === undefined ? [JS_DEFAULT_EXPORT_NAME] : [statement.name.text];
  }
  if (ts.isVariableStatement(statement)) {
    const names: string[] = [];
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNames(declaration.name, names);
    }
    return names;
  }
  return [];
}

function collectBindingNames(name: ts.BindingName, into: string[]): void {
  if (ts.isIdentifier(name)) {
    into.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }
    collectBindingNames(element.name, into);
  }
}

/**
 * Is this edge at the top of the file?
 *
 * **False for 13.6% of requires** — 1,048 in a function body and 179 in a block.
 * The walk up stops at the first function or block, which is what makes the
 * count mean what the schema says it means.
 */
/**
 * Where the enclosing-method walk starts for a node that may sit in a comment.
 *
 * A JSDoc block is attached to the node it DOCUMENTS, so walking up from a
 * type inside `/** @param {import('./x').Y} p *\/ function f(p) {}` reaches
 * `f` — and the row is then "owned" by a method whose span starts on the next
 * line. 1,071 rows outside their owner on the first corpus run. The method
 * that contains a comment is the one containing its HOST, so the walk starts
 * at the host's parent. A node that is not in a comment starts at itself.
 */
function methodWalkStartOf(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node;
  while (current !== undefined && current.kind !== ts.SyntaxKind.JSDoc) {
    current = current.parent;
  }
  return current?.parent?.parent ?? node;
}

function isTopLevel(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isSourceFile(current)) {
      return true;
    }
    if (ts.isBlock(current) || ts.isFunctionLike(current) || ts.isCaseClause(current)
      || ts.isClassLike(current)) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Is this edge inside something that may not run?
 *
 * An `if`, a `try`, a ternary, or the right side of `&&`/`||`/`??`. A module
 * edge that may never execute is a different claim from one that always does,
 * and it is the column that keeps `overwritesPreviousExport` from asserting a
 * runtime conclusion.
 */
function isConditional(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  let child: ts.Node = node;
  while (current !== undefined) {
    if (ts.isSourceFile(current) || ts.isFunctionLike(current)) {
      return false;
    }
    if (ts.isIfStatement(current) || ts.isTryStatement(current)
      || ts.isSwitchStatement(current) || ts.isConditionalExpression(current)) {
      return true;
    }
    if (ts.isBinaryExpression(current) && current.right === child
      && (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || current.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      return true;
    }
    child = current;
    current = current.parent;
  }
  return false;
}

