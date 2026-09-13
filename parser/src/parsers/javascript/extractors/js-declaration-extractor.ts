import * as path from 'path';

import * as ts from 'typescript';

import {
  JS_ANONYMOUS_METHOD_NAMES,
  JS_ANONYMOUS_TYPE_NAME,
  JS_MODULE_INITIALIZER_NAME,
} from '@/constants/javascript-constants';
import { JsBlockRegistry } from '@/analysis-types/javascript/JsBlockRegistry';
import { JsFieldRegistry } from '@/analysis-types/javascript/JsFieldRegistry';
import { JsMethodParameterRegistry } from
  '@/analysis-types/javascript/JsMethodParameterRegistry';
import { JsMethodRegistry } from '@/analysis-types/javascript/JsMethodRegistry';
import { JsTypeHeritageRegistry } from
  '@/analysis-types/javascript/JsTypeHeritageRegistry';
import { JsTypeRegistry } from '@/analysis-types/javascript/JsTypeRegistry';
import { JsVariableRegistry } from '@/analysis-types/javascript/JsVariableRegistry';
import { JsBlockKind } from '@/enums/javascript/blocks';
import { JsDeclaredTypeSource } from '@/enums/javascript/common';
import { JsAccessorPairKind, JsFieldDeclarationForm } from '@/enums/javascript/fields';
import { JsHeritageForm } from '@/enums/javascript/heritage';
import { JsParameterBindingForm } from '@/enums/javascript/method-parameters';
import {
  JsBodyPresence,
  JsHoisting,
  JsMethodDeclarationForm,
  JsMethodKind,
  JsThisBinding,
} from '@/enums/javascript/methods';
import {
  JsEvidenceKind,
  JsTypeCategory,
  JsTypeDeclarationForm,
} from '@/enums/javascript/types';
import {
  JsBindingRegime,
  JsInitializerKind,
  JsVariableBindingForm,
} from '@/enums/javascript/variables';
import {
  JsTypeReferenceContextKind,
  JsTypeReferenceOwnerKind,
} from '@/enums/javascript/type-references';
import { ScopeBuildResult } from '@/parsers/javascript/extractors/js-scope-builder';
import { JsBinding, JsScopeNode, nodeKey, resolveName } from
  '@/parsers/javascript/extractors/js-symbol-table';
import {
  enclosingStatement,
  isCallableExpression,
  isRequireCall,
  jsDocTagsOfAllBlocks,
  lastLineOf,
  rangeOf, jsDocParameterTagFor,
} from '@/utils/javascript';

/**
 * Types, methods, parameters, fields, variables, blocks and heritage, in one
 * walk.
 *
 * ## One walk, and every construct on exactly one path
 *
 * §2 of `BUILDING-A-PARSER.md`: **duplicate keys do not collide, they DOUBLE.**
 * A construct reached by two visit paths mints an identical primary key and the
 * row count quietly doubles with nothing looking wrong — no error, no warning,
 * and every count still plausible. A member decorator reached twice did exactly
 * that in TypeScript.
 *
 * So this is a single recursive dispatch with an explicit context, rather than
 * several passes each looking for what it cares about. Where a construct is
 * genuinely two things — `Foo.prototype.bar = function () {}` is a method
 * declaration *and* an assignment that executes — it is visited once here and
 * once by the expression walker, into **two different relations**, and the two
 * rows point at each other.
 *
 * ## Owner derivation is carried, never re-derived
 *
 * The enclosing type, method, scope and block travel in {@link WalkContext}. The
 * alternative — walking `.parent` pointers or comparing positions at each row —
 * picks the wrong owner whenever two candidates begin at the same offset, which
 * in JavaScript is constant: an IIFE's parenthesis, its function and its call
 * all start together.
 *
 * ## Child keys chain off the parent hash
 *
 * A method's qualified name is built from its owner's, never re-derived from the
 * source. `module.exports = class {}` yields a type whose only name is its
 * file's, and two such files in one directory would collide on any name-derived
 * key.
 */
export interface DeclarationExtractionOptions {
  readonly sourceFile: ts.SourceFile;
  readonly binder: ScopeBuildResult;
  readonly filePath: string;
  readonly fileName: string;
  readonly baseMservPath: string;
  readonly moduleHash: string;
  readonly moduleQualifiedName: string;
  readonly serviceVersionLinkHash: string;
  /** Scope hash by the binder's scope key, from `js-scope-extractor`. */
  readonly hashOfScope: (scope: JsScopeNode) => string;
}

/**
 * A link that cannot be made until a later pass has minted the hash it needs.
 *
 * Kept as data rather than as a callback closure over a node, because the node
 * is the lookup key and storing state on it is forbidden: node wrappers get
 * evicted and the failure is **silent at scale** — right on ten files, dropping
 * rows on ten thousand.
 */
export interface PendingExpressionLink {
  /** `nodeKey` of the expression whose hash is wanted. */
  readonly nodeIdentity: string;
  readonly link: (hash: string) => void;
}

export class JsDeclarationExtractor {
  readonly types: JsTypeRegistry[] = [];
  readonly methods: JsMethodRegistry[] = [];
  readonly methodParameters: JsMethodParameterRegistry[] = [];
  readonly fields: JsFieldRegistry[] = [];
  readonly variables: JsVariableRegistry[] = [];
  readonly heritages: JsTypeHeritageRegistry[] = [];
  readonly blocks: JsBlockRegistry[] = [];

  /** `nodeKey` -> hash, for the passes that follow. */
  readonly typeHashByNode = new Map<string, string>();
  readonly methodHashByNode = new Map<string, string>();
  readonly fieldHashByNode = new Map<string, string>();
  readonly variableHashByNode = new Map<string, string>();
  readonly parameterHashByNode = new Map<string, string>();
  readonly blockHashByNode = new Map<string, string>();

  /**
   * Declarations minted FROM an assignment, by the `nodeKey` of that
   * assignment.
   *
   * Read by the expression walker to set `isDeclarationBearing` and
   * `declarationLinkHash`, and by the linking step to fill
   * `sourceExpressionLinkHash` the other way. Gate 7.3.7 asserts the round trip.
   */
  readonly declarationByAssignment = new Map<string, string>();

  /** Links deferred until the expression pass has run. */
  readonly pendingExpressionLinks: PendingExpressionLink[] = [];

  /**
   * Start offsets a comment may attach to, recorded where the node is known.
   *
   * A comment scan knows only the offset of the node it precedes, and for
   * `/** @type {T} *\/ const cache = []` that node is the **statement** — while
   * the variable's own row is keyed on the identifier `cache`, several tokens
   * later. Registering both offsets is what lets the comment find its owner;
   * deriving it later would mean re-walking ancestors from an offset, which is
   * the position comparison this front end avoids everywhere else.
   */
  readonly commentOwnerStarts = new Map<number, { kind: string; hash: string }>();

  /**
   * `@typedef`/`@callback` tags and the `js_type` rows they declared.
   *
   * Handed to the JSDoc pass, which emits the type EXPRESSION tree, and to the
   * comment linking step, which fills `jsdocCommentLinkHash` — the evidence for
   * a `COMMENT_ONLY` row, and what the gate checks against `declaresType`.
   */
  readonly jsDocTypeTags: {
    tag: ts.JSDocTypedefTag | ts.JSDocCallbackTag; row: JsTypeRegistry;
  }[] = [];

  /**
   * Positions whose declared type has a TREE to emit, collected as the rows are
   * minted.
   *
   * The owner kind and the AST node are both known here and nowhere else, so
   * collecting them at mint time is what stops a later pass re-deriving an owner
   * by walking ancestors — which picks the wrong one whenever two candidates
   * begin at the same offset.
   */
  readonly pendingTypeReferences: {
    node: ts.Node;
    ownerKind: JsTypeReferenceOwnerKind;
    ownerHash: string;
    /**
     * For an EXPRESSION owner: the expression node whose row is the owner. The
     * row does not exist until the expression pass runs, so the hash is
     * resolved by the fact extractor at link time rather than here.
     */
    ownerNode?: ts.Node;
    contextKind: JsTypeReferenceContextKind;
    functionNode?: ts.Node;
    parameterName?: string;
    link: (hash: string) => void;
  }[] = [];

  /**
   * Statements whose `@type` a declaration path already claimed.
   *
   * The EXPRESSION owner is the owner of last resort. `this.x = …` in a
   * constructor gives its `@type` to the field, `ret = …` to the variable,
   * `Foo.prototype.m = …` to the assigned member. A statement in this set is
   * not offered to the expression owner as well, which is the two-paths-to-one-
   * construct hazard applied to a type reference: one annotation, one tree.
   */
  private readonly typeClaimedStatements = new Set<string>();
  /** EXPRESSION-owner candidates, offered only what no declaration path claimed. */
  private readonly expressionOwnerCandidates: {
    statement: ts.Node; ownerNode: ts.Node; contextKind: JsTypeReferenceContextKind;
  }[] = [];

  /** `@type` over `identifier = …`, resolved to its binding; linked after variables exist. */
  private readonly typedAssignments: { statement: ts.Node; binding: JsBinding }[] = [];

  /** The synthetic `<module>` method that owns top-level executable code. */
  moduleInitMethodHash = '';

  private readonly options: DeclarationExtractionOptions;
  private readonly sourceFile: ts.SourceFile;
  /** Binding -> its emitted row, so a later pass can link without re-deriving. */
  private readonly variableRowByBinding = new Map<JsBinding, JsVariableRegistry>();
  /**
   * Type row by the name it is bound to in this file.
   *
   * The index that makes `Foo.prototype.bar = …` findable: the assignment names
   * `Foo`, and the declaration it belongs to is whatever `Foo` was declared as.
   * Same-file only, by construction — reaching into another file to find `Foo`
   * would be cross-file resolution.
   */
  /**
   * Types by name — **all of them**, in declaration order, with their nodes.
   *
   * ## A name is not an identity, and this is the sixth instance of that
   *
   * It was `Map<string, JsTypeRegistry>` and first-wins. A module holding two
   * declarations named `Parser` — which is what a bundle IS — gave every
   * `Parser.prototype.x = …` after the second one to the first. 252 colliding
   * names over 4,561 files, 659 shadowed types.
   *
   * The same failure as `js_parse_gap`'s key, `boundVariableLinkHash`'s,
   * `importByLocalName`'s, `declarationTargetByName`'s,
   * `accessorFieldByOwnerAndName`'s, and the reverse import link that resolved
   * a variable's NAME to an import and wrote itself onto it: a key that is a
   * TUPLE OF NAMES is unique only as long as the names are, and JavaScript
   * promises that nowhere. §2 already says it — node identity is the BYTE
   * RANGE — and these were seven places that used a name instead.
   *
   * THE CLASS IS CLOSED AT SEVEN. Every name-keyed index in this front end has
   * been enumerated and re-keyed on a node, a position or a hash. The next one
   * is a regression, not a discovery, and `javascript-key-collisions.ts` is the
   * sweep that finds it.
   *
   * ## Resolved at the REFERENCE, by position
   *
   * A prototype assignment names its owner with an identifier, so there is no
   * byte range at the reference to key on — the range that decides is the
   * DECLARATION's. `Foo.prototype.m = …` belongs to the nearest `Foo` declared
   * at or before it, which is what a reader sees and what fixes the bundle case
   * without changing any single-declaration file.
   */
  private readonly typesByName = new Map<string, Array<{
    row: JsTypeRegistry; start: number;
  }>>();
  /** Accessor pairs, so a getter and a setter for one name produce ONE field row. */
  private readonly accessorFieldByOwnerAndName = new Map<string, JsFieldRegistry>();
  /**
   * Members counted per type, as they are discovered.
   *
   * Kept here rather than read back off the row. A constructor function's
   * members arrive one assignment at a time across the whole file, so the count
   * is not knowable when the row is minted — and a registry is a ROW, not a
   * counter. Adding a getter to it would put the tally in a generated file,
   * where the next regeneration deletes it: that already happened once, and the
   * fix is to move the state rather than re-apply the patch.
   */
  private readonly memberCountByType = new Map<JsTypeRegistry, number>();
  /** First bound name of each destructuring, so its siblings can point at it. */
  private readonly patternRootByDeclaration = new Map<string, string>();

  constructor(options: DeclarationExtractionOptions) {
    this.options = options;
    this.sourceFile = options.sourceFile;
  }

  run(): void {
    // The module initializer first: every top-level statement needs an owning
    // method, and in CommonJS that is not a fiction — Node wraps the file in a
    // function, so the top level genuinely IS a function body.
    const moduleInit = this.mintModuleInitializer();
    this.moduleInitMethodHash = moduleInit.getHash();

    const moduleBlock = this.mintModuleBlock();

    const context: WalkContext = {
      scope: this.options.binder.moduleScope,
      ownerType: undefined,
      ownerMethod: moduleInit,
      ownerMethodQualifiedName: this.options.moduleQualifiedName,
      block: moduleBlock,
      childIndexByBlock: new Map(),
    };

    // Types first, so an assignment-borne member can find the type it belongs
    // to however the file orders them: `Foo.prototype.m = …` above
    // `function Foo() {}` is legal and common, because the declaration hoists.
    this.indexDeclaredTypes();

    for (const statement of this.sourceFile.statements) {
      this.visit(statement, context);
    }

    // `@typedef` and `@callback`: types whose ONLY evidence is a comment. Minted
    // before variables so an exported name can find one.
    this.emitJsDocTypedefs();

    // Variables last among the declaration relations: they come from the
    // BINDER's table rather than from a syntax walk, which is what lets a `var`
    // written in a block be emitted against the function scope it hoists to.
    this.emitVariables();

    // EXPRESSION owners of last resort: every candidate whose statement no
    // declaration path claimed during the walk.
    for (const candidate of this.expressionOwnerCandidates) {
      if (this.typeClaimedStatements.has(nodeKey(candidate.statement))) {
        continue;
      }
      this.pendingTypeReferences.push({
        node: candidate.statement,
        ownerKind: JsTypeReferenceOwnerKind.EXPRESSION,
        ownerHash: '',
        ownerNode: candidate.ownerNode,
        contextKind: candidate.contextKind,
        link: () => { /* the expression row has no type column to fill */ },
      });
    }

    // The `@type`-over-assignment references, now that their variables exist.
    // The tree is OWNED by the variable, which is what makes it reachable; the
    // variable's own typeReferenceLinkHash keeps its declaration's tree if it
    // has one, because the declaration is the primary statement of its type.
    for (const { statement, binding } of this.typedAssignments) {
      const row = this.variableRowByBinding.get(binding);
      if (row === undefined) {
        continue;
      }
      this.pendingTypeReferences.push({
        node: statement,
        ownerKind: JsTypeReferenceOwnerKind.VARIABLE,
        ownerHash: row.getHash(),
        contextKind: JsTypeReferenceContextKind.VARIABLE,
        link: (hash) => {
          if (row.typeReferenceLinkHashValue() === '') {
            row.setTypeReferenceLinkHash(hash);
          }
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // the module's own rows
  // -------------------------------------------------------------------------

  private mintModuleInitializer(): JsMethodRegistry {
    const moduleScope = this.options.binder.moduleScope;
    const row = new JsMethodRegistry({
      name: JS_MODULE_INITIALIZER_NAME,
      qualifiedName: `${this.options.moduleQualifiedName}.${JS_MODULE_INITIALIZER_NAME}`,
      fileName: this.options.fileName,
      filePath: this.options.filePath,
      baseMservPath: this.options.baseMservPath,
      startLine: 1,
      endLine: lastLineOf(this.sourceFile),
      startColumn: 1,
      methodKind: JsMethodKind.MODULE_INITIALIZER,
      declarationForm: JsMethodDeclarationForm.SYNTACTIC,
      hoisting: JsHoisting.NOT_APPLICABLE,
      isAsync: false,
      isGenerator: false,
      isStatic: false,
      parameterCount: 0,
      hasRestParameter: false,
      usesArguments: false,
      // `this` at a CommonJS top level is `module.exports`; in an ES module it
      // is `undefined`. Two different values from one syntax, so the honest
      // answer is to decline rather than pick one.
      thisBinding: JsThisBinding.NONE,
      returnTypeName: '',
      declaredTypeSource: JsDeclaredTypeSource.NONE,
      bodyPresence: JsBodyPresence.HAS_BODY,
      ownerTypeLinkHash: '',
      ownerModuleLinkHash: this.options.moduleHash,
      ownerScopeLinkHash: this.options.hashOfScope(moduleScope),
      bodyScopeLinkHash: this.options.hashOfScope(moduleScope),
      enclosingMethodLinkHash: '',
      isEntryPoint: false,
      methodReferenceKind: '',
      modifiers: '',
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.methods.push(row);
    return row;
  }

  private mintModuleBlock(): JsBlockRegistry {
    const end = this.sourceFile.getLineAndCharacterOfPosition(this.sourceFile.end);
    const row = new JsBlockRegistry({
      blockKind: JsBlockKind.MODULE_BODY,
      label: '',
      parentBlockLinkHash: '',
      depth: 0,
      childIndex: 0,
      scopeLinkHash: this.options.hashOfScope(this.options.binder.moduleScope),
      opensScope: true,
      ownerMethodLinkHash: this.moduleInitMethodHash,
      ownerModuleLinkHash: this.options.moduleHash,
      startLine: 1,
      startColumn: 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.blocks.push(row);
    return row;
  }

  // -------------------------------------------------------------------------
  // the walk
  // -------------------------------------------------------------------------

  /**
   * Nodes a declaring construct has already handled in full.
   *
   * ## The rule this makes mechanical
   *
   * §6 says a tree rooted at a non-emitting node dies before its children are
   * enqueued; constraint 4 says a construct reached by two visit paths mints an
   * identical key and DOUBLES. The two pull in opposite directions, and the walk
   * resolved them by having every declaring construct `return` — which satisfies
   * the second and violates the first.
   *
   * It cost 116 callables over 4,561 files, in four shapes that all look
   * different and are one bug:
   *
   * - `Query.prototype._find = wrapThunk(function (cb) { … })` — the value is a
   *   CALL, so it takes the field branch and the function inside it vanishes.
   *   26 in one file of one package.
   * - `Object.assign(Foo.prototype, mixin(), { … })` — a non-literal argument is
   *   skipped and never walked.
   * - `Object.defineProperty(F.prototype, 'x', { value: wrap(function () {}) })`
   *   — only `get` and `set` are consumed.
   * - `util.inherits(Child, makeBase())` — the arguments are read as a heritage
   *   expression and never walked for declarations.
   *
   * Every one of them lost a js_method row, its parameters, its body and its
   * scope, with nothing missing from any count anyone was looking at.
   *
   * So the descent is now UNCONDITIONAL and the CONSUMPTION is explicit: a
   * construct that fully handles a subtree says so, and the generic walk skips
   * exactly that subtree and nothing else. Both rules hold at once, and neither
   * depends on remembering to write a descent by hand at a new call site.
   *
   * ## Per FILE, and that is load-bearing
   *
   * `nodeKey` is `kind:start:end`, which is unique within a source file and
   * **not across one** — two files have a node of the same kind at the same
   * offsets constantly. This extractor is constructed once per file inside
   * `extractJavaScriptFile`, so the set dies with the file. A longer-lived one
   * would silently suppress emission in the second file of every pair that
   * happened to collide, which is constraint 1's failure mode exactly: right on
   * ten files, dropping rows on ten thousand.
   */
  private readonly consumedNodes = new Set<string>();

  private visit(node: ts.Node, context: WalkContext): void {
    // Already minted, with its whole subtree, by a declaring construct that
    // reached it directly. Descending again would visit it on a SECOND path and
    // mint an identical key — and a duplicate key does not collide, it DOUBLES.
    if (this.consumedNodes.has(nodeKey(node))) {
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      this.visitClass(node, context);
      return;
    }
    if (ts.isFunctionDeclaration(node)) {
      const row = this.visitFunctionLike(node, context, JsMethodKind.FUNCTION_DECLARATION,
        JsHoisting.HOISTED_FULLY, JsMethodDeclarationForm.SYNTACTIC, undefined);
      // A constructor FUNCTION is a constructor, and its body declares instance
      // state exactly as a class constructor's does. `function Router(o) {
      // this.options = o }` is the dominant pre-ES6 way of declaring a member,
      // and looking only inside class constructors misses every one of them.
      // BY NODE, not by name. Two declarations can share a name in one file —
      // `class Parser` and a later `function Parser` in a bundle — and a
      // name lookup is first-wins, so the second function's `this.x =` members
      // were attributed to the first declaration, outside its own line span.
      const declaredType = this.typeByDeclarationNode.get(nodeKey(node));
      if (declaredType !== undefined) {
        declaredType.setConstructorMethodLinkHash(row.getHash());
        this.constructorByTypeHash.set(declaredType.getHash(), row.getHash());
        if (node.body !== undefined) {
          this.emitThisAssignedFields(node.body, declaredType);
        }
      }
      return;
    }
    if (ts.isFunctionExpression(node)) {
      const row = this.visitFunctionLike(node, context, JsMethodKind.FUNCTION_EXPRESSION,
        JsHoisting.NOT_HOISTED, JsMethodDeclarationForm.SYNTACTIC, undefined);
      // The same treatment a constructor FUNCTION DECLARATION gets, for one
      // bound by assignment. Without it `var Logger = function (o) { this.x = o }`
      // has a js_type and a js_method that know nothing about each other: no
      // constructorMethodLinkHash, and every `this.x =` field unattributed.
      const declaredType = this.typeByDeclarationNode.get(nodeKey(node));
      if (declaredType !== undefined) {
        declaredType.setConstructorMethodLinkHash(row.getHash());
        this.constructorByTypeHash.set(declaredType.getHash(), row.getHash());
        if (node.body !== undefined) {
          this.emitThisAssignedFields(node.body, declaredType);
        }
      }
      return;
    }
    if (ts.isArrowFunction(node)) {
      this.visitFunctionLike(node, context, JsMethodKind.ARROW,
        JsHoisting.NOT_HOISTED, JsMethodDeclarationForm.SYNTACTIC, undefined);
      return;
    }
    // `/** @type {T} *\/ (expr)` — an inline JSDoc CAST, the PARENTHESISED form
    // and only that form, which is the one the compiler treats as an assertion.
    // A parenthesis emits no expression row (§6 unwraps it), so the owner is
    // the expression it wraps, resolved after the expression pass like every
    // EXPRESSION owner. 1,170 of these had no context to be emitted under.
    // ON THE PARENTHESIS ITSELF — `node.jsDoc`, not `ts.getJSDocTypeTag`, which
    // walks up to the enclosing declaration and would read
    // `/** @type {T} *\/ const x = (raw)` as a cast of `raw`. js-fixtures' 5b is
    // that exact control, and the first cut emitted CAST and VARIABLE for it.
    if (ts.isParenthesizedExpression(node)
      && jsDocTagsOfAllBlocks(node).some((tag) => tag.kind === ts.SyntaxKind.JSDocTypeTag
        && (tag as ts.JSDocTypeTag).typeExpression !== undefined)) {
      let inner: ts.Expression = node.expression;
      while (ts.isParenthesizedExpression(inner)) {
        inner = inner.expression;
      }
      this.pendingTypeReferences.push({
        node,
        ownerKind: JsTypeReferenceOwnerKind.EXPRESSION,
        ownerHash: '',
        ownerNode: inner,
        contextKind: JsTypeReferenceContextKind.CAST,
        link: () => { /* an expression row has no type column to fill */ },
      });
    }
    // `{ /** @type {T} *\/ items: [] }` — an annotated OBJECT-LITERAL PROPERTY.
    // An object literal is a value, not a type (§3.2), so there is no js_field
    // to own this; the property's VALUE expression is the owner. 268 over the
    // corpus with nowhere to go before EXPRESSION was ruled.
    if (ts.isPropertyAssignment(node)
      && ts.getJSDocTypeTag(node)?.typeExpression !== undefined) {
      this.pendingTypeReferences.push({
        node,
        ownerKind: JsTypeReferenceOwnerKind.EXPRESSION,
        ownerHash: '',
        ownerNode: node.initializer,
        contextKind: JsTypeReferenceContextKind.FIELD,
        link: () => { /* an expression row has no type column to fill */ },
      });
    }
    // A METHOD OR ACCESSOR IN AN OBJECT LITERAL: `{ m(x) { … }, get g() { … } }`.
    //
    // Reached only from the generic descent — a CLASS member never gets here,
    // because `visitClassMember` is called directly by `visitClass`. So this
    // branch is exactly the object-literal case.
    //
    // It was missing, and it was the single largest source of lost facts in the
    // parser: 3,210 of 3,264 call-site recall misses over 4,529 files, 98.3% of
    // them, 1.94% of all shipped-source call sites. the five worst
    // packages between 290 and 757 each. Seven forms all lost — shorthand,
    // get, set, async, generator, computed-name and nested — while the LONGHAND
    // `fnExpr: function (x) { … }` and the arrow beside them were walked
    // correctly, which is what says it is this node kind and not a policy.
    //
    // §6 in its purest form: the tree was rooted at a node neither walker
    // recognised, so the body died before its children were enqueued. Nothing
    // was miscounted — the calls simply were not there.
    //
    // The kind is what the LONGHAND already emits, because the two are the same
    // function written two ways. No new vocabulary: an object literal is not a
    // js_type, so there is no owner and the member is not a CLASS_METHOD.
    if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)
      || ts.isSetAccessorDeclaration(node)) {
      this.visitFunctionLike(node, context,
        ts.isGetAccessorDeclaration(node) ? JsMethodKind.GETTER
          : ts.isSetAccessorDeclaration(node) ? JsMethodKind.SETTER
            : JsMethodKind.FUNCTION_EXPRESSION,
        JsHoisting.NOT_HOISTED, JsMethodDeclarationForm.SYNTACTIC, undefined);
      if (ts.isComputedPropertyName(node.name)) {
        this.visit(node.name.expression, this.ordinaryCode(node.name.expression, context));
      }
      return;
    }
    if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)
      && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      // `/** @type {T} */ ret = …` — an @type over an assignment to a BARE
      // IDENTIFIER. The identifier resolves to a variable declared elsewhere,
      // and that variable is what the annotation is ABOUT, exactly as
      // `/** @type {T} */ this.x = …` is about the field. The member form
      // reached; this one produced nothing, and it is the shape a
      // route-everything-to-CAST fix would misclassify first, because it is the
      // one currently silent (js-fixtures 5h and 5k).
      //
      // Recorded now and linked after `emitVariables`, because the variable rows
      // come from the binder's table and do not exist yet during the walk.
      // Narrow on purpose: an identifier target only. `items.push(4)` under an
      // @type attaches to nothing the parser can type, and must stay nothing.
      if (ts.isIdentifier(node.expression.left)
        && ts.getJSDocTypeTag(node)?.typeExpression !== undefined) {
        const resolved = resolveName(context.scope, node.expression.left.text);
        if (resolved !== undefined) {
          this.typedAssignments.push({ statement: node, binding: resolved.binding });
          this.typeClaimedStatements.add(nodeKey(node));
        }
      }
      // `/** @type {T} *\/ exports.X = …` and any other annotated assignment no
      // declaration path claims: the EXPRESSION is the owner of last resort.
      // Decided AFTER the declaring paths below have run, at the end of this
      // branch, so a prototype member or a constructor field keeps its own.
      const annotatedAssignment = ts.getJSDocTypeTag(node)?.typeExpression !== undefined
        ? node : undefined;
      // The assignment forms that are DECLARATIONS. Minted here, once, and then
      // the walk CONTINUES into the subtree: whatever the declaring construct
      // handled in full has marked itself consumed, and anything it did not is
      // ordinary code that still contains declarations.
      const declaredMember = this.visitDeclaringAssignment(node.expression, context);
      if (declaredMember) {
        this.typeClaimedStatements.add(nodeKey(node));
      }
      if (annotatedAssignment !== undefined) {
        // A CANDIDATE, decided after the walk. The claim from a constructor's
        // `this.x =` is made by emitThisAssignedFields, which runs AFTER the
        // body statements are visited — so a claim checked here, at push time,
        // was checked too early and js-fixtures' 5c emitted a FIELD tree and an
        // EXPRESSION tree for one annotation. Candidates are resolved against
        // the claimed set once every path has had its say.
        this.expressionOwnerCandidates.push({
          statement: node,
          ownerNode: node.expression,
          // A property of an object — `exports.X`, `obj.k` — is the position
          // being typed, and FIELD is the vocabulary for "the declared type of
          // a property". The owner says which object; this says what kind of
          // position.
          contextKind: JsTypeReferenceContextKind.FIELD,
        });
      }
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      this.visitDeclaringCall(node.expression, context);
    }
    if (ts.isIfStatement(node)) {
      // The `else` branch is its OWN block. Emitting only IF loses which arm a
      // statement is in — the two are mutually exclusive control flow, and an
      // engine joining on the IF block alone reads both arms as reachable
      // together. The audit found this: ELSE was declared and never emitted.
      this.visitIfStatement(node, context);
      return;
    }
    if (ts.isTryStatement(node)) {
      this.visitTryStatement(node, context);
      return;
    }
    if (isBlockLike(node)) {
      this.visitBlock(node, context);
      return;
    }
    // Everything else: descend in the same context. Unconditional, because a
    // subtree rooted at a node that emits nothing still contains declarations —
    // §6's parenthesis and JSX-brace failures were both a subtree dying before
    // its children were enqueued.
    ts.forEachChild(node, (child) => {
      this.visit(child, this.contextFor(child, context));
    });
  }

  /**
   * The context for descending into code that is NOT a member of anything.
   *
   * ## One rule, because clearing it by hand is how the bug keeps coming back
   *
   * `ownerType` means "the type whose member I am about to emit". It is valid
   * for exactly as long as the walk is looking at a member, and the moment it
   * descends into ordinary code that code is NOT a member — an arrow inside a
   * method body, inside a field initializer, inside a parameter default.
   *
   * Inheriting it made 2,422 anonymous callables read as members of classes
   * they were merely nested in. That was fixed by clearing the field at the one
   * place it leaked. Then a new descent into class-field initializers was added
   * and **it came straight back**, 30 of them, because
   * `static descriptors = { _scriptable: (name) => … }` is a field initializer
   * carrying arrows and the class context was passed straight through.
   *
   * So the rule is a function with a name, used at every descent into ordinary
   * code, rather than a `ownerType: undefined` that has to be remembered.
   */
  private ordinaryCode(node: ts.Node, context: WalkContext): WalkContext {
    return { ...this.contextFor(node, context), ownerType: undefined };
  }

  /** The scope a child sits in, if the binder opened one for it. */
  private contextFor(node: ts.Node, context: WalkContext): WalkContext {
    const scope = this.options.binder.enclosingScopeOf.get(nodeKey(node));
    if (scope === undefined || scope === context.scope) {
      return context;
    }
    return { ...context, scope };
  }

  // -------------------------------------------------------------------------
  // classes
  // -------------------------------------------------------------------------

  private visitClass(node: ts.ClassLikeDeclaration, context: WalkContext): void {
    const at = this.positionOf(node);
    const name = node.name?.text ?? '';
    const isDeclaration = ts.isClassDeclaration(node);
    const qualifiedName = name === ''
      ? `${context.ownerMethodQualifiedName}.${JS_ANONYMOUS_TYPE_NAME}`
      : `${this.options.moduleQualifiedName}.${name}`;
    // The scope the class OPENS — `enclosingScopeOf` is the one it sits in.
    const classScope = this.options.binder.scopeOpenedBy.get(nodeKey(node)) ?? context.scope;

    const row = new JsTypeRegistry({
      name: name === '' ? JS_ANONYMOUS_TYPE_NAME : name,
      qualifiedName,
      fileName: this.options.fileName,
      filePath: this.options.filePath,
      baseMservPath: this.options.baseMservPath,
      startLine: at.startLine,
      endLine: at.endLine,
      startColumn: at.startColumn,
      typeCategory: name === '' ? JsTypeCategory.ANONYMOUS_CLASS : JsTypeCategory.CLASS,
      declarationForm: isDeclaration
        ? JsTypeDeclarationForm.CLASS_DECLARATION
        : JsTypeDeclarationForm.CLASS_EXPRESSION,
      // Parity slot: JavaScript has no `abstract`.
      isAbstract: false,
      modifiers: '',
      evidenceKind: JsEvidenceKind.SYNTAX,
      isTypeOnly: false,
            ownerModuleLinkHash: this.options.moduleHash,
      ownerScopeLinkHash: this.options.hashOfScope(context.scope),
      enclosingMethodLinkHash: context.ownerMethod?.getHash() ?? '',
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.memberCountByType.set(row, node.members.length);
    row.setDeclaredMemberCount(node.members.length);
    this.types.push(row);
    this.typeHashByNode.set(nodeKey(node), row.getHash());
    this.typeNodeByHash.set(row.getHash(), node);
    if (name !== '') {
      this.recordTypeName(name, row, node);
    }

    this.emitExtendsClause(node, row, context);

    const childContext: WalkContext = {
      ...context,
      scope: classScope,
      ownerType: row,
      ownerMethodQualifiedName: qualifiedName,
    };
    const classBlock = this.mintBlock(node, JsBlockKind.CLASS_BODY, classScope, context, true);
    for (const member of node.members) {
      this.visitClassMember(member, { ...childContext, block: classBlock });
    }
  }

  /**
   * `class Child extends Parent` — the one heritage form syntax states directly.
   *
   * The three call- and assignment-borne forms are handled where the assignment
   * is, in {@link visitDeclaringAssignment} and {@link visitDeclaringCall},
   * because there is no class node to hang them off.
   */
  private emitExtendsClause(
    node: ts.ClassLikeDeclaration,
    type: JsTypeRegistry,
    context: WalkContext
  ): void {
    for (const clause of node.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
        continue;
      }
      for (const expression of clause.types) {
        this.emitHeritage({
          ownerType: type,
          form: JsHeritageForm.EXTENDS_CLAUSE,
          superExpression: expression.expression,
          context,
          sourceNode: undefined,
        });
      }
    }
  }

  private emitHeritage(init: {
    ownerType: JsTypeRegistry;
    form: JsHeritageForm;
    superExpression: ts.Expression;
    context: WalkContext;
    sourceNode: ts.Node | undefined;
  }): void {
    const at = this.positionOf(init.superExpression);
    // The NAME as written, and nothing resolved. `EventEmitter` stays
    // `EventEmitter`; `require('events').EventEmitter` keeps its whole
    // expression text. Those two plus `importLinkHash` are the three things §0
    // says make a row complete, and `resolvedTypeLinkHash` stays tier 3.
    const written = init.superExpression.getText(this.sourceFile);
    const simpleName = ts.isIdentifier(init.superExpression)
      ? init.superExpression.text
      : ts.isPropertyAccessExpression(init.superExpression)
        ? init.superExpression.name.text
        : '';
    const row = new JsTypeHeritageRegistry({
      ownerTypeLinkHash: init.ownerType.getHash(),
      // Always 0: JavaScript is single-inheritance.
      position: 0,
      heritageForm: init.form,
      superTypeName: simpleName === '' ? written : simpleName,
      superTypeExpressionText: written,
      isComputedSuperclass: simpleName === '',
      // Always true: JavaScript has no `implements`, so TypeScript's
      // extends/implements distinction collapses.
      inheritsMembers: true,
      startLine: at.startLine,
      ownerModuleLinkHash: this.options.moduleHash,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.heritages.push(row);
    if (init.sourceNode !== undefined) {
      const identity = nodeKey(init.sourceNode);
      this.pendingExpressionLinks.push({
        nodeIdentity: identity,
        link: (hash) => {
          row.setSourceExpressionLinkHash(hash);
        },
      });
      this.declarationByAssignment.set(identity, row.getHash());
    }
  }

  private visitClassMember(member: ts.ClassElement, context: WalkContext): void {
    if (ts.isConstructorDeclaration(member)) {
      const row = this.visitFunctionLike(member, context, JsMethodKind.CONSTRUCTOR,
        JsHoisting.NOT_APPLICABLE, JsMethodDeclarationForm.SYNTACTIC, undefined);
      context.ownerType?.setConstructorMethodLinkHash(row.getHash());
      if (context.ownerType !== undefined) {
        this.constructorByTypeHash.set(context.ownerType.getHash(), row.getHash());
      }
      // `this.x = …` in a constructor DECLARES a member, and it is the dominant
      // way pre-ES6 code declares instance state — so the field extractor has to
      // look inside a function body, not only at a class body's members.
      if (member.body !== undefined && context.ownerType !== undefined) {
        this.emitThisAssignedFields(member.body, context.ownerType);
      }
      return;
    }
    if (ts.isMethodDeclaration(member)) {
      this.visitFunctionLike(member, context, JsMethodKind.CLASS_METHOD,
        JsHoisting.TDZ, JsMethodDeclarationForm.SYNTACTIC, undefined);
      return;
    }
    if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      const isGetter = ts.isGetAccessorDeclaration(member);
      const row = this.visitFunctionLike(member, context,
        isGetter ? JsMethodKind.GETTER : JsMethodKind.SETTER,
        JsHoisting.TDZ, JsMethodDeclarationForm.SYNTACTIC, undefined);
      this.recordAccessor(member, row, isGetter, context);
      return;
    }
    if (ts.isClassStaticBlockDeclaration(member)) {
      this.visitFunctionLike(member, context, JsMethodKind.STATIC_BLOCK,
        JsHoisting.NOT_APPLICABLE, JsMethodDeclarationForm.SYNTACTIC, undefined);
      return;
    }
    if (ts.isPropertyDeclaration(member)) {
      this.emitClassField(member, context);
      // `handleClick = () => { … }` — a class field holding an arrow is the
      // standard way to write an auto-bound method, and it IS a callable member.
      // Without a js_method row the arrow's body had no owner, so every
      // expression inside it was attributed to the `<module>` initializer, and
      // c32 had nothing to point at. CLASS_METHOD for the role, and the arrow's
      // own thisBinding = LEXICAL carries the difference from a prototype
      // method — which is the reason people write it this way.
      if (member.initializer !== undefined && isCallableExpression(member.initializer)) {
        this.visitFunctionLike(
          member.initializer as ts.FunctionLikeDeclaration, context,
          JsMethodKind.CLASS_METHOD, JsHoisting.NOT_APPLICABLE,
          JsMethodDeclarationForm.SYNTACTIC, undefined,
          ts.isComputedPropertyName(member.name) ? '' : propertyNameText(member.name),
          // NO assignedOwner: the owner resolves through `context.ownerType`,
          // which is this class, and passing it explicitly would ALSO increment
          // `declaredMemberCount` — which already counted this member as part of
          // `node.members.length`. The field row and the method row describe ONE
          // member, and the count must say one. Verified: a five-member class
          // with two arrow fields reported seven. `countMember` exists for
          // members discovered by assignment OUTSIDE the class body, which are
          // not in `node.members` and genuinely need counting.
          undefined,
          hasModifier(member, ts.SyntaxKind.StaticKeyword)
        );
      } else if (member.initializer !== undefined) {
        // A field initializer that is NOT itself a callable can still CONTAIN
        // one: `static descriptors = { _scriptable: (name) => name !== 'x' }`
        // is how one charting library writes its per-option predicates, and every arrow in
        // there had no js_method row. The field is a declaration; what it is
        // initialised to is ordinary code and has to be walked.
        this.visit(member.initializer, this.ordinaryCode(member.initializer, context));
      }
      if (ts.isComputedPropertyName(member.name)) {
        this.visit(member.name.expression, this.ordinaryCode(member.name.expression, context));
      }
      return;
    }
    // Anything else in a class body — an index signature parsed out of Flow, a
    // semicolon. Descend so nothing inside is lost, and NOT as a member: this
    // branch is reached precisely because the node is not one.
    ts.forEachChild(member, (child) => {
      this.visit(child, this.ordinaryCode(child, context));
    });
  }

  // -------------------------------------------------------------------------
  // callables
  // -------------------------------------------------------------------------

  private visitFunctionLike(
    node: ts.FunctionLikeDeclaration | ts.ClassStaticBlockDeclaration,
    context: WalkContext,
    kind: JsMethodKind,
    hoisting: JsHoisting,
    declarationForm: JsMethodDeclarationForm,
    /** For an assignment-declared method, the assignment node. */
    sourceNode: ts.Node | undefined,
    /** For an assignment-declared method, the name it was given. */
    assignedName?: string,
    assignedOwner?: JsTypeRegistry,
    isStaticMember?: boolean
  ): JsMethodRegistry {
    // CONSUMED. This callable and everything inside it is handled here, so the
    // generic descent must not reach it again — see {@link consumedNodes}.
    this.consumedNodes.add(nodeKey(node));
    const at = this.positionOf(node);
    // The scope the callable OPENS. It was `enclosingScopeOf`, which is the scope the
    // callable is declared IN, so every method's bodyScopeLinkHash pointed at
    // its enclosing scope — populated, valid, and wrong on every row.
    const bodyScope = this.options.binder.scopeOpenedBy.get(nodeKey(node)) ?? context.scope;
    const name = assignedName ?? this.nameOfCallable(node, kind);
    const ownerType = assignedOwner ?? context.ownerType;
    const qualifiedName = ownerType !== undefined
      ? `${ownerType.qualifiedName}.${name}`
      : `${context.ownerMethodQualifiedName}.${name}`;

    const parameters = ts.isClassStaticBlockDeclaration(node)
      ? ([] as readonly ts.ParameterDeclaration[])
      : node.parameters;
    const returnType = declaredTypeFromJsDoc(node, this.sourceFile, 'returns');
    const body = ts.isClassStaticBlockDeclaration(node) ? node.body : node.body;

    const row = new JsMethodRegistry({
      name,
      qualifiedName,
      fileName: this.options.fileName,
      filePath: this.options.filePath,
      baseMservPath: this.options.baseMservPath,
      startLine: at.startLine,
      endLine: at.endLine,
      startColumn: at.startColumn,
      methodKind: kind,
      declarationForm,
      hoisting,
      isAsync: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
      isGenerator: !ts.isClassStaticBlockDeclaration(node)
        && node.asteriskToken !== undefined,
      isStatic: isStaticMember ?? hasModifier(node, ts.SyntaxKind.StaticKeyword),
      parameterCount: parameters.length,
      hasRestParameter: parameters.some((p) => p.dotDotDotToken !== undefined),
      // `arguments` is a parameter list nobody declared. An engine modelling
      // only named parameters loses the whole channel, so the flag is read from
      // the body rather than inferred from the parameter count.
      usesArguments: body !== undefined && referencesArguments(body),
      thisBinding: thisBindingFor(kind),
      returnTypeName: returnType.name,
      declaredTypeSource: returnType.source,
      bodyPresence: bodyPresenceOf(body),
      ownerTypeLinkHash: ownerType?.getHash() ?? '',
      ownerModuleLinkHash: this.options.moduleHash,
      ownerScopeLinkHash: this.options.hashOfScope(context.scope),
      bodyScopeLinkHash: this.options.hashOfScope(bodyScope),
      enclosingMethodLinkHash: context.ownerMethod?.getHash() ?? '',
      isEntryPoint: false,
      // Parity slot with Java, always `""` — JavaScript has no `::`.
      methodReferenceKind: '',
      modifiers: modifiersOf(node),
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.methods.push(row);
    this.methodHashByNode.set(nodeKey(node), row.getHash());
    this.methodNodeByIdentity.set(nodeKey(node), node);
    if (assignedOwner !== undefined) {
      this.countMember(assignedOwner);
    }

    if (sourceNode !== undefined) {
      const identity = nodeKey(sourceNode);
      this.pendingExpressionLinks.push({
        nodeIdentity: identity,
        link: (hash) => {
          row.setSourceExpressionLinkHash(hash);
        },
      });
      this.declarationByAssignment.set(identity, row.getHash());
    }

    for (let index = 0; index < parameters.length; index += 1) {
      this.emitParameter(parameters[index]!, index, row, bodyScope);
    }

    const childContext: WalkContext = {
      ...context,
      scope: bodyScope,
      ownerMethod: row,
      ownerMethodQualifiedName: qualifiedName,
      // CLEARED. Anything declared inside a method BODY is not a member of the
      // enclosing type — an arrow inside `startWorking()` is a local callable,
      // and `enclosingMethodLinkHash` is the link that says where it lives.
      // Inheriting the owner made 2,422 anonymous callables over 816 real files
      // read as members of a class, so an engine listing a type's methods got
      // phantom `<arrow>` entries. Found by following js-oracle's
      // declaredMemberCount check one step further.
      ownerType: undefined,
    };

    // A PARAMETER'S DEFAULT VALUE is code, and `emitParameter` emits a row for
    // the parameter without walking it.
    //
    // `({ shouldUseFileNameAsKey = () => true } = {}) => { … }` and
    // `function f(contexts, node, modifier = (node) => node)` are the shapes —
    // a callable that exists only as a default, which had no js_method row at
    // all. The same §6 loss as the body, one level to the left, and easy to
    // miss because the parameter row IS emitted and looks complete.
    //
    // `forEachChild` rather than just `.initializer`, because a destructured
    // parameter carries its defaults on the BINDING ELEMENTS inside the
    // pattern, not on the parameter itself.
    for (const parameter of parameters) {
      ts.forEachChild(parameter, (child) => {
        this.visit(child, this.ordinaryCode(child, { ...context, scope: bodyScope,
          ownerMethod: row, ownerMethodQualifiedName: qualifiedName }));
      });
    }

    // THE DESCENT. §6: the worklist stops at function boundaries and must be
    // descended EXPLICITLY — `return function () { … }` once emitted the
    // function and nothing inside it, costing 45 of 691 call sites, and every
    // row that WAS emitted was correct. There were simply fewer of them.
    if (body !== undefined) {
      if (ts.isBlock(body)) {
        // A `static { … }` body is a CLASS_STATIC_BLOCK, not a function body.
        // It reaches this path because a static block is modelled as a callable
        // — it has its own scope and its own `this` — and the block row was
        // taking the kind of the path rather than the kind of the construct.
        // CLASS_STATIC_BLOCK was 0 of 148,000 block rows while the matching
        // js_scope row was emitted correctly beside it, which is what said the
        // construct was reached and only the label was wrong.
        const bodyBlock = this.mintBlock(body,
          kind === JsMethodKind.STATIC_BLOCK
            ? JsBlockKind.CLASS_STATIC_BLOCK
            : JsBlockKind.FUNCTION_BODY,
          bodyScope, context, true);
        for (const statement of body.statements) {
          this.visit(statement, { ...childContext, block: bodyBlock });
        }
      } else {
        this.visit(body, childContext);
      }
    }
    // NO second pass over `parameter.initializer` here. One stood after the
    // body descent from the day prototype assignments landed, and the
    // `forEachChild` walk above was added later without removing it — so every
    // default value was visited on TWO paths. Nothing showed for as long as
    // every construct a default can hold was deduplicated elsewhere (callables
    // by `consumedNodes`, expressions by their own walk); the first thing that
    // was not, a JSDoc cast in a default, doubled its key on the day it was
    // emitted. Constraint 4: visit each construct on exactly one path.
    return row;
  }

  private nameOfCallable(
    node: ts.FunctionLikeDeclaration | ts.ClassStaticBlockDeclaration,
    kind: JsMethodKind
  ): string {
    if (kind === JsMethodKind.CONSTRUCTOR) {
      return JS_ANONYMOUS_METHOD_NAMES.CONSTRUCTOR;
    }
    if (kind === JsMethodKind.STATIC_BLOCK) {
      return JS_ANONYMOUS_METHOD_NAMES.STATIC_BLOCK;
    }
    if (ts.isClassStaticBlockDeclaration(node)) {
      return JS_ANONYMOUS_METHOD_NAMES.STATIC_BLOCK;
    }
    const name = node.name;
    if (name === undefined) {
      return kind === JsMethodKind.ARROW
        ? JS_ANONYMOUS_METHOD_NAMES.ARROW
        : JS_ANONYMOUS_METHOD_NAMES.FUNCTION_EXPRESSION;
    }
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    if (ts.isPrivateIdentifier(name)) {
      return name.text;
    }
    // A computed member name. Syntax does not fix it, so the row says so rather
    // than guessing — 715 computed member names were measured.
    return '';
  }

  private emitParameter(
    parameter: ts.ParameterDeclaration,
    position: number,
    owner: JsMethodRegistry,
    scope: JsScopeNode
  ): void {
    const at = this.positionOf(parameter);
    const declaredType = declaredTypeFromJsDoc(parameter, this.sourceFile, 'param');
    // `@param {T} [x]` / `[x=y]` — the bracket IS the optionality, and the
    // schema says so ("JSDoc [x] or a default value"). Both columns were
    // derived from the code alone and the bracket discarded on the way past:
    // a silent loss, since the type still came out right. The SAME selection
    // that typed the parameter, so a bracket on a tag that names another
    // parameter cannot leak here. hasDefault/defaultValueText stay the code's:
    // whether a comment-only `[x=y]` populates them is filed, not decided.
    const documentingTag = jsDocParameterTagFor(parameter);
    // TWO JSDoc optional markers, and the checker treats them identically
    // (§3.5a): `[x]` is `isBracketed`, `{T=}` is a JSDocOptionalType at the
    // root of the type expression — 29% of documented optionals, and a
    // parameter whose own type tree says OPTIONAL while c6 says false is the
    // populated-and-wrong shape. Both public tests; `ts.isOptionalDeclaration`
    // is internal and throws on ordinary input.
    const bracketed = documentingTag !== undefined && ts.isJSDocParameterTag(documentingTag)
      && documentingTag.isBracketed;
    const optionalTyped = documentingTag?.typeExpression?.type !== undefined
      && ts.isJSDocOptionalType(documentingTag.typeExpression.type);
    const isIdentifier = ts.isIdentifier(parameter.name);
    const bindingForm = isIdentifier
      ? (parameter.initializer !== undefined
        ? JsParameterBindingForm.ASSIGNMENT_PATTERN
        : JsParameterBindingForm.IDENTIFIER)
      : ts.isObjectBindingPattern(parameter.name)
        ? JsParameterBindingForm.OBJECT_PATTERN
        : JsParameterBindingForm.ARRAY_PATTERN;
    const row = new JsMethodParameterRegistry({
      // `""` for a destructuring pattern: the parameter binds N names and none
      // of them is the parameter's own name. The names are js_variable rows.
      name: isIdentifier ? (parameter.name as ts.Identifier).text : '',
      position,
      ownerMethodLinkHash: owner.getHash(),
      declaredTypeName: declaredType.name,
      declaredTypeSource: declaredType.source,
      isOptional: parameter.questionToken !== undefined
        || parameter.initializer !== undefined
        || bracketed
        || optionalTyped,
      hasDefault: parameter.initializer !== undefined,
      defaultValueText: parameter.initializer?.getText(this.sourceFile) ?? '',
      isRest: parameter.dotDotDotToken !== undefined,
      bindingForm,
      patternBindingCount: isIdentifier ? 0 : countPatternBindings(parameter.name),
      bindingRegime: JsBindingRegime.PARAMETER,
      scopeLinkHash: this.options.hashOfScope(scope),
      startLine: at.startLine,
      startColumn: at.startColumn,
      // Parity slot with TypeScript, always `false`.
      isParameterProperty: false,
      ownerModuleLinkHash: this.options.moduleHash,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.methodParameters.push(row);
    this.parameterHashByNode.set(nodeKey(parameter), row.getHash());
    if (declaredType.source !== JsDeclaredTypeSource.NONE) {
      this.pendingTypeReferences.push({
        node: parameter,
        ownerKind: JsTypeReferenceOwnerKind.METHOD_PARAMETER,
        ownerHash: row.getHash(),
        contextKind: JsTypeReferenceContextKind.PARAM,
        functionNode: parameter.parent,
        parameterName: isIdentifier ? (parameter.name as ts.Identifier).text : '',
        link: (hash) => {
          row.setTypeReferenceLinkHash(hash);
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // fields
  // -------------------------------------------------------------------------

  private emitClassField(member: ts.PropertyDeclaration, context: WalkContext): void {
    if (context.ownerType === undefined) {
      return;
    }
    const at = this.positionOf(member);
    const fieldType = declaredTypeFromJsDoc(member, this.sourceFile, 'type');
    const computed = ts.isComputedPropertyName(member.name);
    const name = computed ? '' : propertyNameText(member.name);
    const row = new JsFieldRegistry({
      name,
      qualifiedName: `${context.ownerType.qualifiedName}.${name}`,
      ownerTypeLinkHash: context.ownerType.getHash(),
      declarationForm: JsFieldDeclarationForm.CLASS_FIELD,
      isStatic: hasModifier(member, ts.SyntaxKind.StaticKeyword),
      // `#x` specifically, not `_x`: the first is an access boundary the runtime
      // enforces, the second is a naming convention.
      isPrivateName: ts.isPrivateIdentifier(member.name),
      declaredTypeName: fieldType.name,
      declaredTypeSource: fieldType.source,
      hasInitializer: member.initializer !== undefined,
      accessorPairKind: JsAccessorPairKind.NONE,
      isComputedName: computed,
      startLine: at.startLine,
      startColumn: at.startColumn,
      ownerModuleLinkHash: this.options.moduleHash,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.fields.push(row);
    this.fieldHashByNode.set(nodeKey(member), row.getHash());
    if (fieldType.source !== JsDeclaredTypeSource.NONE) {
      this.pendingTypeReferences.push({
        node: member,
        ownerKind: JsTypeReferenceOwnerKind.FIELD,
        ownerHash: row.getHash(),
        contextKind: JsTypeReferenceContextKind.FIELD,
        link: (hash) => {
          row.setTypeReferenceLinkHash(hash);
        },
      });
    }
    if (member.initializer !== undefined) {
      const identity = nodeKey(member.initializer);
      this.pendingExpressionLinks.push({
        nodeIdentity: identity,
        link: (hash) => {
          row.setInitializerExpressionLinkHash(hash);
        },
      });
    }
  }

  /**
   * `this.x = …` inside a constructor or constructor function.
   *
   * Walked with its own recursion rather than the main dispatch, because it must
   * NOT descend into nested functions: `this` inside a nested `function` is a
   * different receiver entirely, so `function () { this.x = 1 }` inside a
   * constructor declares a member of something else. An arrow IS descended into,
   * because an arrow's `this` is the constructor's.
   */
  private emitThisAssignedFields(body: ts.Node, ownerType: JsTypeRegistry): void {
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
        || ts.isClassLike(node)) {
        return;
      }
      if (ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isPropertyAccessExpression(node.left)
        && node.left.expression.kind === ts.SyntaxKind.ThisKeyword) {
        this.emitAssignedField({
          ownerType,
          name: node.left.name.text,
          form: JsFieldDeclarationForm.CONSTRUCTOR_THIS_ASSIGNMENT,
          isStatic: false,
          isComputedName: false,
          at: this.positionOf(node.left),
          assignment: node,
          hasInitializer: true,
        });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(body, visit);
  }

  private emitAssignedField(init: {
    ownerType: JsTypeRegistry;
    name: string;
    form: JsFieldDeclarationForm;
    isStatic: boolean;
    isComputedName: boolean;
    at: Position;
    assignment: ts.Node;
    hasInitializer: boolean;
  }): JsFieldRegistry {
    // `/** @type {T} */ this.x = …` — the JSDoc sits on the STATEMENT, not on
    // the assignment expression, so the lookup walks out to it. Without this
    // every member declared by assignment lost its declared type, which in a
    // pre-ES6 codebase is every member there is.
    const declaredType = declaredTypeFromJsDoc(
      enclosingStatement(init.assignment) ?? init.assignment, this.sourceFile, 'type'
    );
    const row = new JsFieldRegistry({
      name: init.name,
      qualifiedName: `${init.ownerType.qualifiedName}.${init.name}`,
      ownerTypeLinkHash: init.ownerType.getHash(),
      declarationForm: init.form,
      isStatic: init.isStatic,
      isPrivateName: init.name.startsWith('#'),
      declaredTypeName: declaredType.name,
      declaredTypeSource: declaredType.source,
      hasInitializer: init.hasInitializer,
      accessorPairKind: JsAccessorPairKind.NONE,
      isComputedName: init.isComputedName,
      startLine: init.at.startLine,
      startColumn: init.at.startColumn,
      ownerModuleLinkHash: this.options.moduleHash,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.fields.push(row);
    if (declaredType.source !== JsDeclaredTypeSource.NONE) {
      const statement = enclosingStatement(init.assignment) ?? init.assignment;
      this.typeClaimedStatements.add(nodeKey(statement));
      this.pendingTypeReferences.push({
        node: statement,
        ownerKind: JsTypeReferenceOwnerKind.FIELD,
        ownerHash: row.getHash(),
        contextKind: JsTypeReferenceContextKind.FIELD,
        link: (hash) => {
          row.setTypeReferenceLinkHash(hash);
        },
      });
    }
    this.countMember(init.ownerType);
    const identity = nodeKey(init.assignment);
    this.pendingExpressionLinks.push({
      nodeIdentity: identity,
      link: (hash) => {
        row.setSourceExpressionLinkHash(hash);
      },
    });
    this.declarationByAssignment.set(identity, row.getHash());
    // `this.x = …` inside a class constructor is an OWN property per instance,
    // not a prototype member. Setting the flag for it would claim every ES6
    // class in the corpus has prototype-assigned members, which is the opposite
    // of what the column is for — it exists to identify pre-ES6 shapes.
    if (init.form !== JsFieldDeclarationForm.CONSTRUCTOR_THIS_ASSIGNMENT) {
      init.ownerType.setHasPrototypeMembers();
    }
    return row;
  }

  /**
   * A getter and a setter for one name produce ONE field row.
   *
   * Keyed on owner plus name, so the second accessor upgrades the pair kind
   * rather than minting a second row — which would **double** the field count
   * for every accessor pair in the corpus and look entirely plausible.
   */
  private recordAccessor(
    member: ts.AccessorDeclaration,
    method: JsMethodRegistry,
    isGetter: boolean,
    context: WalkContext
  ): void {
    if (context.ownerType === undefined) {
      return;
    }
    const name = ts.isComputedPropertyName(member.name) ? '' : propertyNameText(member.name);
    // THE PAIRING KEY, and both of its discriminators were missing.
    //
    // It was `ownerHash:name`. Two defects in one key, and the measured one is
    // not the obvious one.
    //
    // (1) NO `isStatic`. `class C { static get x(){} get x(){} }` declares two
    // different members and they shared a key, so a static getter could pair
    // with an instance setter.
    //
    // (2) A COMPUTED name reports `''`, so `get [a]()` and `get [b]()` on one
    // class were indistinguishable — and staticness would not separate them
    // either. Every collision actually measured over 4,561 files was this, not
    // the static case: 4 keys, 5 shadowed accessors.
    //
    // For a computed key the honest answer is to REFUSE TO PAIR. Whether
    // `get [a]()` and `set [a]()` are one property depends on what `a` evaluates
    // to at class-definition time, which is a runtime fact — the same reason
    // INDEX_CALL is reserved. So a computed accessor keys on its own BYTE RANGE
    // and therefore pairs with nothing, which loses a pairing that was never
    // knowable and prevents inventing one that is wrong.
    const discriminator = ts.isComputedPropertyName(member.name)
      ? `computed@${member.getStart(this.sourceFile)}:${member.getEnd()}`
      : `${name}:${hasModifier(member, ts.SyntaxKind.StaticKeyword)}`;
    const key = `${context.ownerType.getHash()}:${discriminator}`;
    const existing = this.accessorFieldByOwnerAndName.get(key);
    if (existing !== undefined) {
      existing.setAccessorPairKind(JsAccessorPairKind.GETTER_SETTER);
      if (isGetter) {
        existing.setGetterMethodLinkHash(method.getHash());
      } else {
        existing.setSetterMethodLinkHash(method.getHash());
      }
      return;
    }
    const at = this.positionOf(member);
    // `/** @type {T} */ get x() { … }` — the type of the PROPERTY the accessor
    // pair presents, which is this field. It was hard-coded to none: 70 of 70
    // getter `@type` tags over the corpus emitted no reference, while the same
    // tag on a class field beside them did. Read from the getter (a setter's
    // `@type` is unusual and describes the same property), through the same
    // selection every other field uses.
    const accessorType = declaredTypeFromJsDoc(member, this.sourceFile, 'type');
    const row = new JsFieldRegistry({
      name,
      qualifiedName: `${context.ownerType.qualifiedName}.${name}`,
      ownerTypeLinkHash: context.ownerType.getHash(),
      declarationForm: JsFieldDeclarationForm.CLASS_FIELD,
      isStatic: hasModifier(member, ts.SyntaxKind.StaticKeyword),
      isPrivateName: ts.isPrivateIdentifier(member.name),
      declaredTypeName: accessorType.name,
      declaredTypeSource: accessorType.source,
      hasInitializer: false,
      accessorPairKind: isGetter
        ? JsAccessorPairKind.GETTER_ONLY
        : JsAccessorPairKind.SETTER_ONLY,
      isComputedName: ts.isComputedPropertyName(member.name),
      startLine: at.startLine,
      startColumn: at.startColumn,
      ownerModuleLinkHash: this.options.moduleHash,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    if (isGetter) {
      row.setGetterMethodLinkHash(method.getHash());
    } else {
      row.setSetterMethodLinkHash(method.getHash());
    }
    this.fields.push(row);
    if (accessorType.source !== JsDeclaredTypeSource.NONE) {
      this.pendingTypeReferences.push({
        node: member,
        ownerKind: JsTypeReferenceOwnerKind.FIELD,
        ownerHash: row.getHash(),
        contextKind: JsTypeReferenceContextKind.FIELD,
        link: (hash) => {
          row.setTypeReferenceLinkHash(hash);
        },
      });
    }
    this.accessorFieldByOwnerAndName.set(key, row);
  }

  // -------------------------------------------------------------------------
  // declarations written as assignments
  // -------------------------------------------------------------------------

  /**
   * Recognises an assignment that is really a declaration, and returns whether
   * it was one.
   *
   * ## The §3 defect class, and the reason this method exists
   *
   * `Foo.prototype.bar = function () {}` emits trivially as an assignment with a
   * function on the right. **The structure is entirely absent** from that
   * emission: nothing says `bar` is a member of `Foo`. Get it wrong and the
   * engine sees no methods at all in any pre-ES6 codebase.
   *
   * Four shapes, all measured, and `STATIC_ASSIGNMENT` at 521 is more common
   * than the famous prototype one at 361.
   */
  private visitDeclaringAssignment(
    assignment: ts.BinaryExpression,
    context: WalkContext
  ): boolean {
    const target = assignment.left;
    if (!ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) {
      return false;
    }

    // `Child.prototype = <expr>` — either a heritage edge or a bulk member
    // install, decided by what is on the right.
    if (ts.isPropertyAccessExpression(target) && target.name.text === 'prototype') {
      const ownerName = typeNameOfExpression(target.expression);
      if (ownerName !== undefined) {
        return this.visitPrototypeReplacement(assignment, ownerName, context);
      }
    }

    // `Foo.prototype.bar = …` — an instance member.
    if (ts.isPropertyAccessExpression(target)
      && ts.isPropertyAccessExpression(target.expression)
      && target.expression.name.text === 'prototype'
      && typeNameOfExpression(target.expression.expression) !== undefined) {
      return this.emitAssignedMember({
        assignment,
        ownerName: typeNameOfExpression(target.expression.expression)!,
        memberName: target.name.text,
        isStatic: false,
        methodForm: JsMethodDeclarationForm.PROTOTYPE_ASSIGNMENT,
        fieldForm: JsFieldDeclarationForm.PROTOTYPE_ASSIGNMENT,
        nameNode: target.name,
        context,
      });
    }

    // `Foo.staticM = …` — the static counterpart, and the more common one.
    // Only when `Foo` is a type declared in THIS file: `exports.x = …` and
    // `module.exports.x = …` are module edges, not members, and `obj.x = …` on
    // an ordinary object is neither.
    if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
      const owner = this.typeNamedAt(target.expression.text, target);
      if (owner !== undefined) {
        return this.emitAssignedMember({
          assignment,
          ownerName: target.expression.text,
          memberName: target.name.text,
          isStatic: true,
          methodForm: JsMethodDeclarationForm.STATIC_ASSIGNMENT,
          fieldForm: JsFieldDeclarationForm.STATIC_ASSIGNMENT,
          nameNode: target.name,
          context,
        });
      }
    }
    return false;
  }

  /**
   * `Child.prototype = <expr>`.
   *
   * Three different constructs share this syntax and only the right-hand side
   * tells them apart:
   *
   * - `= Object.create(Parent.prototype)` — an **inheritance edge**.
   * - `= new Parent()` — an inheritance edge, and a broken one: it runs the
   *   parent constructor at definition time.
   * - `= { m() {}, n() {} }` — a **bulk member install**, which also discards
   *   whatever was on the prototype before, `constructor` included.
   */
  private visitPrototypeReplacement(
    assignment: ts.BinaryExpression,
    ownerName: string,
    context: WalkContext
  ): boolean {
    const owner = this.typeNamedAt(ownerName, assignment);
    if (owner === undefined) {
      return false;
    }
    const value = assignment.right;

    if (ts.isCallExpression(value) && isObjectCreate(value) && value.arguments.length > 0) {
      this.emitHeritage({
        ownerType: owner,
        form: JsHeritageForm.OBJECT_CREATE_PROTOTYPE,
        superExpression: prototypeOwnerOf(value.arguments[0]!) ?? value.arguments[0]!,
        context,
        sourceNode: assignment,
      });
      return true;
    }
    if (ts.isNewExpression(value)) {
      this.emitHeritage({
        ownerType: owner,
        form: JsHeritageForm.PROTOTYPE_ASSIGNMENT,
        superExpression: value.expression,
        context,
        sourceNode: assignment,
      });
      return true;
    }
    if (ts.isObjectLiteralExpression(value)) {
      this.emitPrototypeObjectLiteral(value, owner, assignment, context);
      return true;
    }
    if (ts.isPropertyAccessExpression(value) && value.name.text === 'prototype') {
      this.emitHeritage({
        ownerType: owner,
        form: JsHeritageForm.PROTOTYPE_ASSIGNMENT,
        superExpression: value.expression,
        context,
        sourceNode: assignment,
      });
      return true;
    }
    return false;
  }

  private emitPrototypeObjectLiteral(
    literal: ts.ObjectLiteralExpression,
    owner: JsTypeRegistry,
    assignment: ts.Node,
    context: WalkContext
  ): void {
    owner.setHasPrototypeMembers();
    for (const property of literal.properties) {
      if (ts.isMethodDeclaration(property)) {
        this.visitFunctionLike(property, context, JsMethodKind.CLASS_METHOD,
          JsHoisting.NOT_APPLICABLE, JsMethodDeclarationForm.PROTOTYPE_OBJECT_LITERAL,
          assignment, propertyNameText(property.name), owner, false);
        continue;
      }
      if (ts.isPropertyAssignment(property)) {
        const name = ts.isComputedPropertyName(property.name)
          ? '' : propertyNameText(property.name);
        if (isCallableExpression(property.initializer)) {
          this.visitFunctionLike(
            property.initializer as ts.FunctionLikeDeclaration, context,
            JsMethodKind.CLASS_METHOD,
            JsHoisting.NOT_HOISTED, JsMethodDeclarationForm.PROTOTYPE_OBJECT_LITERAL,
            assignment, name, owner, false);
          continue;
        }
        this.emitAssignedField({
          ownerType: owner,
          name,
          form: JsFieldDeclarationForm.PROTOTYPE_ASSIGNMENT,
          isStatic: false,
          isComputedName: ts.isComputedPropertyName(property.name),
          at: this.positionOf(property),
          assignment,
          hasInitializer: true,
        });
      }
    }
  }

  private emitAssignedMember(init: {
    assignment: ts.BinaryExpression;
    ownerName: string;
    memberName: string;
    isStatic: boolean;
    methodForm: JsMethodDeclarationForm;
    fieldForm: JsFieldDeclarationForm;
    nameNode: ts.Node;
    context: WalkContext;
  }): boolean {
    const owner = this.typeNamedAt(init.ownerName, init.assignment);
    if (owner === undefined) {
      return false;
    }
    owner.setHasPrototypeMembers();
    const value = init.assignment.right;
    if (isCallableExpression(value)) {
      // CLASS_METHOD, not FUNCTION_EXPRESSION. The syntax is a function
      // expression and the ROLE is a member of `owner` — `declarationForm`
      // already records the syntax, and `methodKind` records what the thing is.
      // Emitting the syntax here would make every prototype method read as a
      // free function to an engine filtering on kind, and §4's lesson is that a
      // correctly-positioned row with the wrong kind is invisible to recall,
      // completeness and oracle adjudication alike.
      this.visitFunctionLike(value as ts.FunctionLikeDeclaration, init.context,
        JsMethodKind.CLASS_METHOD,
        JsHoisting.NOT_HOISTED, init.methodForm, init.assignment,
        init.memberName, owner, init.isStatic);
      return true;
    }
    this.emitAssignedField({
      ownerType: owner,
      name: init.memberName,
      form: init.fieldForm,
      isStatic: init.isStatic,
      isComputedName: false,
      at: this.positionOf(init.nameNode),
      assignment: init.assignment,
      hasInitializer: true,
    });
    // The value is NOT walked here. It is left to the generic descent, which
    // now runs for every declaring construct — the field row describes the
    // member, and whatever the value contains is ordinary code.
    return true;
  }

  /**
   * A CALL that is really a declaration.
   *
   * `util.inherits(Child, Parent)` is an **extends edge expressed as a call**,
   * and `Object.assign(Foo.prototype, { … })` and
   * `Object.defineProperty(Foo.prototype, 'x', { … })` are bulk member installs.
   *
   * Recognition deliberately does not require the receiver to be literally named
   * `util` or `Object`: `require('util').inherits(…)` and a destructured
   * `const { inherits } = require('util')` are both normal spellings, so the
   * member name plus the argument shape is what identifies the construct.
   */
  private visitDeclaringCall(call: ts.CallExpression, context: WalkContext): boolean {
    const callee = call.expression;
    const memberName = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ts.isIdentifier(callee) ? callee.text : '';

    if (memberName === 'inherits' && call.arguments.length >= 2
      && ts.isIdentifier(call.arguments[0]!)) {
      const owner = this.typeNamedAt((call.arguments[0] as ts.Identifier).text, call);
      if (owner !== undefined) {
        this.emitHeritage({
          ownerType: owner,
          form: JsHeritageForm.UTIL_INHERITS,
          superExpression: call.arguments[1]!,
          context,
          sourceNode: call,
        });
        return true;
      }
    }

    if (memberName === 'assign' && call.arguments.length >= 2) {
      const target = call.arguments[0]!;
      const owner = this.typeOfPrototypeExpression(target);
      if (owner !== undefined) {
        for (let i = 1; i < call.arguments.length; i += 1) {
          const argument = call.arguments[i]!;
          if (ts.isObjectLiteralExpression(argument)) {
            this.emitObjectAssignMembers(argument, owner, call, context);
          }
        }
        return true;
      }
    }

    if (memberName === 'defineProperty' && call.arguments.length >= 3) {
      const owner = this.typeOfPrototypeExpression(call.arguments[0]!);
      const nameArgument = call.arguments[1]!;
      if (owner !== undefined && ts.isStringLiteralLike(nameArgument)) {
        this.emitDefineProperty(call, owner, nameArgument.text,
          call.arguments[2]!, context);
        return true;
      }
    }
    return false;
  }

  /**
   * The type an `X.prototype` or bare `X` expression names, if this file
   * declares one.
   *
   * Same-file only, by construction. `Object.assign(other.prototype, …)` where
   * `other` came from another module names a type this parser cannot see, and
   * reaching through the import to find it would be cross-file resolution — the
   * engine's work. The row is simply not minted, which is the honest answer.
   */
  private typeOfPrototypeExpression(node: ts.Expression): JsTypeRegistry | undefined {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'prototype'
      && ts.isIdentifier(node.expression)) {
      return this.typeNamedAt(node.expression.text, node);
    }
    if (ts.isIdentifier(node)) {
      return this.typeNamedAt(node.text, node);
    }
    return undefined;
  }

  private emitObjectAssignMembers(
    literal: ts.ObjectLiteralExpression,
    owner: JsTypeRegistry,
    call: ts.Node,
    context: WalkContext
  ): void {
    owner.setHasPrototypeMembers();
    for (const property of literal.properties) {
      if (ts.isMethodDeclaration(property)) {
        this.visitFunctionLike(property, context, JsMethodKind.CLASS_METHOD,
          JsHoisting.NOT_APPLICABLE, JsMethodDeclarationForm.OBJECT_ASSIGN_PROTOTYPE,
          call, propertyNameText(property.name), owner, false);
        continue;
      }
      if (ts.isPropertyAssignment(property) && isCallableExpression(property.initializer)) {
        this.visitFunctionLike(
          property.initializer as ts.FunctionLikeDeclaration, context,
          JsMethodKind.CLASS_METHOD,
          JsHoisting.NOT_HOISTED, JsMethodDeclarationForm.OBJECT_ASSIGN_PROTOTYPE,
          call, propertyNameText(property.name), owner, false);
        continue;
      }
      if (ts.isPropertyAssignment(property)) {
        this.emitAssignedField({
          ownerType: owner,
          name: propertyNameText(property.name),
          form: JsFieldDeclarationForm.PROTOTYPE_ASSIGNMENT,
          isStatic: false,
          isComputedName: ts.isComputedPropertyName(property.name),
          at: this.positionOf(property),
          assignment: call,
          hasInitializer: true,
        });
      }
    }
  }

  /**
   * `Object.defineProperty(Foo.prototype, 'x', { get() {}, set() {} })`.
   *
   * The only form that can declare a member non-writable, and the only one where
   * a getter and a setter arrive in one statement — so the field row's
   * `accessorPairKind` is decided from the descriptor literal rather than by
   * pairing two separate declarations.
   */
  private emitDefineProperty(
    call: ts.CallExpression,
    owner: JsTypeRegistry,
    name: string,
    descriptor: ts.Expression,
    context: WalkContext
  ): void {
    owner.setHasPrototypeMembers();
    const field = this.emitAssignedField({
      ownerType: owner,
      name,
      form: JsFieldDeclarationForm.OBJECT_DEFINE_PROPERTY,
      isStatic: false,
      isComputedName: false,
      at: this.positionOf(call),
      assignment: call,
      hasInitializer: true,
    });
    if (!ts.isObjectLiteralExpression(descriptor)) {
      return;
    }
    let hasGetter = false;
    let hasSetter = false;
    for (const property of descriptor.properties) {
      const propertyName = ts.isPropertyAssignment(property)
        || ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property)
        ? propertyNameText(property.name)
        : '';
      if (propertyName === 'writable' && ts.isPropertyAssignment(property)
        && property.initializer.kind === ts.SyntaxKind.FalseKeyword) {
        field.setIsReadonly();
      }
      if (propertyName !== 'get' && propertyName !== 'set') {
        continue;
      }
      // `get: function () {}` and the shorthand `get() {}` are the same
      // descriptor. The shorthand is a MethodDeclaration, which the callable
      // test did not admit, so it fell through to the generic walk as an
      // unowned FUNCTION_EXPRESSION while the field row beside it said
      // accessorPairKind NONE — found by the prototypes torture script.
      const callable = ts.isPropertyAssignment(property)
        ? property.initializer
        : ts.isMethodDeclaration(property) ? property : undefined;
      if (callable === undefined
        || !(isCallableExpression(callable) || ts.isMethodDeclaration(callable))) {
        continue;
      }
      const method = this.visitFunctionLike(
        callable as ts.FunctionLikeDeclaration, context,
        propertyName === 'get' ? JsMethodKind.GETTER : JsMethodKind.SETTER,
        JsHoisting.NOT_HOISTED, JsMethodDeclarationForm.OBJECT_DEFINE_PROPERTY,
        call, name, owner, false);
      if (propertyName === 'get') {
        hasGetter = true;
        field.setGetterMethodLinkHash(method.getHash());
      } else {
        hasSetter = true;
        field.setSetterMethodLinkHash(method.getHash());
      }
    }
    field.setAccessorPairKind(
      hasGetter && hasSetter ? JsAccessorPairKind.GETTER_SETTER
        : hasGetter ? JsAccessorPairKind.GETTER_ONLY
          : hasSetter ? JsAccessorPairKind.SETTER_ONLY
            : JsAccessorPairKind.NONE
    );
  }

  // -------------------------------------------------------------------------
  // constructor functions
  // -------------------------------------------------------------------------

  /**
   * Indexes every type this file declares, BEFORE the walk.
   *
   * Two reasons it cannot be done lazily during the walk:
   *
   * 1. **Function declarations hoist.** `Foo.prototype.m = …` above
   *    `function Foo() {}` is legal and common, and a lazy index would not have
   *    `Foo` yet.
   * 2. **A constructor function is recognised by evidence, not by syntax.** The
   *    evidence is a `new Foo()`, a `Foo.prototype.x = …`, or a `this.x = …` in
   *    the body — all of which may appear anywhere in the file. A capital-letter
   *    heuristic would classify every capitalised import as a constructor.
   */
  private indexDeclaredTypes(): void {
    const constructorNames = this.findConstructorFunctionNames();
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name !== undefined
        && constructorNames.has(node.name.text)) {
        this.mintConstructorFunctionType(node, node.name.text);
      }
      // A CONSTRUCTOR FUNCTION BOUND BY ASSIGNMENT, which is how every
      // 2010-2015 library spells one.
      //
      // The recogniser matched `function A(x) {}` and nothing else, so
      // `var B = function (x) {}`, `var C = function C(x) {}`,
      // `exports.F = function (x) {}` and `var E = exports.E = function (x) {}`
      // minted NO js_type at all — and with it went every prototype method,
      // every `this.x =` field and every heritage edge hanging off that name.
      // one 2015-era logging library lost 56 of 57 prototype members and all 6 of its
      // `util.inherits` edges: 98% of its inheritance model absent, because
      // `var Logger = exports.Logger = function (options) { … }` is the spelling
      // it uses.
      //
      // The evidence is unchanged and still syntactic — `new X`, `X.prototype`,
      // `util.inherits(X, …)` or a body assigning to `this`. Only the shapes the
      // NAME can be bound by are widened, which is why this cannot start
      // classifying ordinary functions as types.
      for (const bound of constructorBindingsOf(node)) {
        if (constructorNames.has(bound.name)) {
          this.mintConstructorFunctionType(bound.callable, bound.name);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(this.sourceFile, visit);
  }

  private findConstructorFunctionNames(): Set<string> {
    const names = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
        names.add(node.expression.text);
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'prototype'
        && ts.isIdentifier(node.expression)) {
        names.add(node.expression.text);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'inherits' && node.arguments.length >= 2) {
        for (const argument of node.arguments) {
          if (ts.isIdentifier(argument)) {
            names.add(argument.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(this.sourceFile, visit);
    // A function whose body assigns to `this` is a constructor too — the
    // pre-ES6 way of declaring instance state, and the only evidence when the
    // type is exported and never `new`-ed in its own file.
    const assignsThis = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name !== undefined
        && node.body !== undefined && bodyAssignsToThis(node.body)) {
        names.add(node.name.text);
      }
      // The same evidence, for a callable bound by assignment. Without this
      // `var Stream = function () { this.x = 1; }` is a constructor with no
      // evidence in its own file unless something happens to `new` it there.
      for (const bound of constructorBindingsOf(node)) {
        if (bound.callable.body !== undefined && bodyAssignsToThis(bound.callable.body)) {
          names.add(bound.name);
        }
      }
      ts.forEachChild(node, assignsThis);
    };
    ts.forEachChild(this.sourceFile, assignsThis);
    return names;
  }

  private mintConstructorFunctionType(
    node: ts.FunctionDeclaration | ts.FunctionExpression,
    name: string
  ): void {
    // Guarded on the NODE rather than on the name: two declarations sharing a
    // name are two entities, and `js_type`'s key already carries startLine and
    // startColumn so both are representable. Guarding on the name collapsed them
    // and put one's members on the other.
    if (this.typeByDeclarationNode.has(nodeKey(node))) {
      return;
    }
    const at = this.positionOf(node);
    // The scope the constructor function is declared IN. `enclosingScopeOf` already
    // answers that; the old code read it as the function's own scope and took
    // `.parent`, which overshot to GLOBAL on every constructor function.
    const scope = this.options.binder.enclosingScopeOf.get(nodeKey(node))
      ?? this.options.binder.moduleScope;
    const row = new JsTypeRegistry({
      name,
      qualifiedName: `${this.options.moduleQualifiedName}.${name}`,
      fileName: this.options.fileName,
      filePath: this.options.filePath,
      baseMservPath: this.options.baseMservPath,
      startLine: at.startLine,
      endLine: at.endLine,
      startColumn: at.startColumn,
      typeCategory: JsTypeCategory.CONSTRUCTOR_FUNCTION,
      declarationForm: JsTypeDeclarationForm.PROTOTYPE_CONSTRUCTOR,
      isAbstract: false,
      modifiers: '',
      evidenceKind: JsEvidenceKind.SYNTAX,
      isTypeOnly: false,
      ownerModuleLinkHash: this.options.moduleHash,
      ownerScopeLinkHash: this.options.hashOfScope(scope),
      enclosingMethodLinkHash: '',
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.types.push(row);
    this.recordTypeName(name, row, node);
    this.typeNodeByHash.set(row.getHash(), node);
    this.typeByDeclarationNode.set(nodeKey(node), row);
    // Deliberately NOT recorded in typeHashByNode: the NODE is a function
    // declaration, and it already maps to a js_method row there. One node, two
    // relations, two indices — conflating them would make a later lookup return
    // whichever was written last.
  }

  // -------------------------------------------------------------------------
  // blocks
  // -------------------------------------------------------------------------

  /**
   * `if (c) A else B` — three rows, not one.
   *
   * The condition belongs to the IF block; `A` and `B` are separate blocks
   * because they are mutually exclusive. A single block for both arms tells an
   * engine that a statement in the `then` and one in the `else` are reachable
   * together, which is the opposite of what the syntax says.
   */
  private visitIfStatement(node: ts.IfStatement, context: WalkContext): void {
    const ifBlock = this.mintBlock(node, JsBlockKind.IF, undefined, context, false);
    this.linkCondition(ifBlock, node.expression);
    const thenContext: WalkContext = {
      ...context, block: ifBlock,
    };
    this.visit(node.expression, thenContext);
    this.visit(node.thenStatement, thenContext);
    if (node.elseStatement === undefined) {
      return;
    }
    // An `else if` chain: the else arm IS another if statement, and giving it an
    // ELSE block of its own as well would mint a block per level of a chain that
    // has no braces. The nested `if` is visited directly and gets its own IF row.
    if (ts.isIfStatement(node.elseStatement)) {
      this.visit(node.elseStatement, thenContext);
      return;
    }
    const elseBlock = this.mintBlock(node.elseStatement, JsBlockKind.ELSE, undefined,
      { ...context, block: ifBlock }, false);
    this.visit(node.elseStatement, {
      ...context, block: elseBlock,
    });
  }

  /**
   * `try A catch (e) B finally C` — four rows.
   *
   * `FINALLY` was declared and never emitted: a finally body is a plain `Block`,
   * so it came out as a generic BLOCK and the fact that it runs on **every**
   * path — including the throwing one — was lost. That is a control-flow claim,
   * not a label.
   */
  private visitTryStatement(node: ts.TryStatement, context: WalkContext): void {
    const tryBlock = this.mintBlock(node, JsBlockKind.TRY, undefined, context, false);
    const inner: WalkContext = {
      ...context, block: tryBlock,
    };
    this.visit(node.tryBlock, inner);
    if (node.catchClause !== undefined) {
      this.visit(node.catchClause, inner);
    }
    if (node.finallyBlock !== undefined) {
      const finallyBlock = this.mintBlock(node.finallyBlock, JsBlockKind.FINALLY,
        undefined, inner, false);
      for (const statement of node.finallyBlock.statements) {
        this.visit(statement, {
          ...inner, block: finallyBlock,
        });
      }
    }
  }

  private visitBlock(node: ts.Node, context: WalkContext): void {
    const kind = blockKindOf(node);
    const condition = conditionOf(node);
    // Does this block OPEN a scope? `enclosingScopeOf` is the one it sits in, which
    // is `context.scope` by construction, so the old test could never be true
    // for a block the binder gave its own scope.
    const scope = this.options.binder.scopeOpenedBy.get(nodeKey(node));
    const opensScope = scope !== undefined;
    const block = this.mintBlock(node, kind, opensScope ? scope : undefined, context,
      opensScope);
    if (condition !== undefined) {
      this.linkCondition(block, condition);
    }
    const childContext: WalkContext = {
      ...context,
      scope: opensScope ? scope! : context.scope,
      block,
    };
    if (ts.isLabeledStatement(node)) {
      this.visit(node.statement, childContext);
      return;
    }
    ts.forEachChild(node, (child) => {
      this.visit(child, childContext);
    });
  }

  private mintBlock(
    node: ts.Node,
    kind: JsBlockKind,
    scope: JsScopeNode | undefined,
    context: WalkContext,
    opensScope: boolean
  ): JsBlockRegistry {
    const at = this.positionOf(node);
    const parentHash = context.block?.getHash() ?? '';
    const childIndex = context.childIndexByBlock.get(parentHash) ?? 0;
    context.childIndexByBlock.set(parentHash, childIndex + 1);
    const row = new JsBlockRegistry({
      blockKind: kind,
      // `outer:`. TypeScript emitted the loop and DROPPED the label, so a
      // `break outer` named a target nothing in the fact base identified.
      label: ts.isLabeledStatement(node) ? node.label.text : '',
      parentBlockLinkHash: parentHash,
      // DERIVED from the parent, not threaded through the context. It was
      // `context.blockDepth`, incremented by hand at each site — `+1` for a then
      // branch, `+2` for an else, nothing at all for a function or class body —
      // and 41 of 66 scaffold blocks disagreed with their parent by the time
      // anything asserted the relation. A depth that is the parent's plus one by
      // construction cannot be threaded wrong.
      depth: context.block === undefined ? 0 : context.block.depth + 1,
      childIndex,
      scopeLinkHash: scope === undefined ? '' : this.options.hashOfScope(scope),
      opensScope,
      ownerMethodLinkHash: context.ownerMethod?.getHash() ?? this.moduleInitMethodHash,
      ownerModuleLinkHash: this.options.moduleHash,
      startLine: at.startLine,
      startColumn: at.startColumn,
      endLine: at.endLine,
      endColumn: at.endColumn,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.blocks.push(row);
    this.blockHashByNode.set(nodeKey(node), row.getHash());
    return row;
  }

  // -------------------------------------------------------------------------
  // variables, from the BINDER rather than from syntax
  // -------------------------------------------------------------------------

  /**
   * Emits one `js_variable` row per binding the binder recorded.
   *
   * ## Why this reads the binder's table and not the syntax
   *
   * The two scope columns are the entire point of this relation, and only the
   * binder knows both: a `var` written inside a block has that block as its
   * syntactic scope and the enclosing **function** scope as its declaration
   * scope. A syntax walk sees one of those and would have to re-implement
   * JavaScript's hoisting rules to find the other.
   *
   * It also means `GLOBAL_IMPLICIT` — a binding with no declaration syntax
   * anywhere — arrives through the same path as every other binding, rather than
   * needing a special case that could be forgotten.
   */
  private emitVariables(): void {
    const reassigned = this.collectReassignedNames();
    for (const binding of this.options.binder.bindings) {
      if (binding.regime === JsBindingRegime.PARAMETER) {
        // A parameter's NAME is a variable row, but its position and default
        // belong to js_method_parameter, which emitParameter already minted.
        // Emitting it here too would be the same construct on two paths.
        continue;
      }
      const node = binding.declarationNode;
      const at = node === null
        ? { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }
        : this.positionOf(node);
      const declaration = node === null ? undefined : declarationOwning(node);
      // endLine is the DECLARATOR's last line, not the name's.
      //
      // The binder records a binding's declarationNode as the name Identifier,
      // and an identifier is always one line — so endLine equalled startLine on
      // all 140,302 rows, by construction, since the first commit. js-oracle
      // ruled it the declarator's extent: `const x = 1` still ends on its own
      // line, `const x = {` … `}` ends where the object literal does. That
      // bounds where the value is CONSTRUCTED, which an engine cannot re-derive
      // from a start line and a name. Redefined rather than removed, because
      // column order is frozen and removal would shift four columns and the PK.
      //
      // The declarator is the nearest declaration the name belongs to: a
      // VariableDeclaration (whose end is its initialiser's), a function or
      // class declaration (its body's end), an import (the specifier's). A
      // parameter never reaches here.
      const declarator = node === null ? undefined : declaratorOf(node);
      const endLine = declarator === undefined
        ? at.endLine
        : this.sourceFile.getLineAndCharacterOfPosition(declarator.getEnd()).line + 1;
      const initializer = declaration !== undefined
        && ts.isVariableDeclaration(declaration)
        ? declaration.initializer
        : undefined;
      // A destructuring declaration's `@type` is the PATTERN's type — `const
      // [{ _instance }, forceUpdate] = …` under `@type {[StoreRef, Fn]}` types
      // the pair, not each name — so it belongs to the pattern ROOT binding
      // alone, as the multi-declarator rule gives a statement's type to its
      // first declarator (§3.14 ruling). Every binding of the pattern took it:
      // one comment, N trees, each with its own owner, so the PK gate saw N
      // distinct keys. The non-root bindings read NONE: their own type is a
      // component the tree does not decompose, and `[StoreRef, Fn]` on
      // `forceUpdate` is a wrong type, not a conservative one.
      const isPatternMember = declaration !== undefined && ts.isVariableDeclaration(declaration)
        && !ts.isIdentifier(declaration.name)
        && this.patternRootByDeclaration.has(nodeKey(declaration));
      const variableType = declaration === undefined || isPatternMember
        ? { name: '', source: JsDeclaredTypeSource.NONE }
        : declaredTypeFromJsDoc(declaration, this.sourceFile, 'type');
      const row = new JsVariableRegistry({
        name: binding.name,
        qualifiedName: `${this.options.moduleQualifiedName}.${binding.name}`,
        bindingRegime: binding.regime,
        declarationScopeLinkHash: this.options.hashOfScope(binding.declarationScope),
        syntacticScopeLinkHash: this.options.hashOfScope(binding.syntacticScope),
        hasTemporalDeadZone: binding.hasTemporalDeadZone,
        bindingForm: bindingFormOf(declaration),
        declaredTypeName: variableType.name,
        declaredTypeSource: variableType.source,
        hasInitializer: initializer !== undefined,
        // The ESM route to "this name is a module alias".
        //
        // `const x = require('y')` gave REQUIRE_CALL 12,345 times corpus-wide;
        // `import { x } from 'y'` gave NONE every time, because an import
        // binding has no VariableDeclaration above it and so no initializer to
        // classify. The enum documents the pair in as many words — REQUIRE_CALL
        // is "the name is a module alias", IMPORT_BINDING is "also a module
        // alias, by the other route" — and only one route was wired.
        //
        // An engine following module aliases therefore saw every CommonJS one
        // and no ESM one: not a wrong answer, a silently half-sized one.
        initializerKind: node !== null && isImportBindingName(node)
          ? JsInitializerKind.IMPORT_BINDING
          : initializerKindOf(initializer),
        ownerMethodLinkHash: this.methodHashForScope(binding.declarationScope),
        ownerModuleLinkHash: this.options.moduleHash,
        startLine: at.startLine,
        startColumn: at.startColumn,
        endLine,
        serviceVersionLinkHash: this.options.serviceVersionLinkHash,
      });
      if (reassigned.has(binding.name)) {
        row.setIsReassigned();
      }
      this.variables.push(row);
      this.variableRowByBinding.set(binding, row);
      // Names bound by ONE destructuring point at a shared root, so
      // `const { a, b } = o` is recoverable as one construct rather than two
      // unrelated bindings that happen to share a line.
      if (declaration !== undefined && ts.isVariableDeclaration(declaration)
        && !ts.isIdentifier(declaration.name)) {
        const rootHash = this.patternRootByDeclaration.get(nodeKey(declaration));
        if (rootHash === undefined) {
          this.patternRootByDeclaration.set(nodeKey(declaration), row.getHash());
        } else {
          row.setPatternRootVariableLinkHash(rootHash);
        }
      }
      if (node !== null) {
        this.registerCommentOwner(enclosingStatement(node), 'VARIABLE', row.getHash());
      }
      if (variableType.source !== JsDeclaredTypeSource.NONE && declaration !== undefined) {
        this.pendingTypeReferences.push({
          node: declaration,
          ownerKind: JsTypeReferenceOwnerKind.VARIABLE,
          ownerHash: row.getHash(),
          contextKind: JsTypeReferenceContextKind.VARIABLE,
          link: (hash) => {
            row.setTypeReferenceLinkHash(hash);
          },
        });
      }
      if (node !== null) {
        this.variableHashByNode.set(nodeKey(node), row.getHash());
      }
      if (initializer !== undefined) {
        const identity = nodeKey(initializer);
        this.pendingExpressionLinks.push({
          nodeIdentity: identity,
          link: (hash) => {
            row.setInitializerExpressionLinkHash(hash);
          },
        });
      }
    }
  }

  /** The row a binding produced, for the passes that link against it. */
  rowForBinding(binding: JsBinding): JsVariableRegistry | undefined {
    return this.variableRowByBinding.get(binding);
  }

  /**
   * The AST node a method row was minted from.
   *
   * Needed by the JSDoc pass, which reads `@returns` and `@template` off the
   * node. The index is inverted here rather than stored on the row, because
   * nothing may be keyed on a parser node object and a row is a ROW.
   */
  nodeForMethod(method: JsMethodRegistry): ts.Node | undefined {
    if (this.methodNodeByHash.size === 0) {
      for (const [identity, hash] of this.methodHashByNode) {
        const node = this.methodNodeByIdentity.get(identity);
        if (node !== undefined) {
          this.methodNodeByHash.set(hash, node);
        }
      }
    }
    return this.methodNodeByHash.get(method.getHash());
  }

  /** The AST node a type row was minted from, for the JSDoc heritage pass. */
  nodeForType(type: JsTypeRegistry): ts.Node | undefined {
    return this.typeNodeByHash.get(type.getHash());
  }

  private readonly methodNodeByHash = new Map<string, ts.Node>();
  private readonly methodNodeByIdentity = new Map<string, ts.Node>();
  private readonly typeNodeByHash = new Map<string, ts.Node>();
  /**
   * Constructor-function types by the NODE that declares them.
   *
   * `typesByName` resolves a reference to the nearest PRECEDING declaration,
   * which is right for `Foo.prototype.m = …` reaching back to `Foo`. It is
   * still the wrong index for attributing a constructor's own `this.x =`
   * members, because those belong to the declaration they are written INSIDE
   * and not to whichever one precedes them — so that attribution keys on the
   * declaring NODE and needs no name at all. Nine fields over 816 real files,
   * found by asking whether every member sits inside its owner's line span.
   */
  private readonly typeByDeclarationNode = new Map<string, JsTypeRegistry>();

  /**
   * The constructor a type declares, by the type's hash.
   *
   * For `js_expression.introducesDeclarationLinkHash`, which is declared
   * FK→`js_method`: a class expression introduces a TYPE, and the callable it
   * introduces is that type's constructor.
   */
  constructorMethodOf(typeHash: string): string | undefined {
    return this.constructorByTypeHash.get(typeHash);
  }

  private readonly constructorByTypeHash = new Map<string, string>();

  /** The type declared under `name` in this file, for same-file one-hop linking. */
  typeNamed(name: string): JsTypeRegistry | undefined {
    return this.typesByName.get(name)?.[0]?.row;
  }

  /** Records a declaration under its name, keeping every one of them. */
  private recordTypeName(name: string, row: JsTypeRegistry, node: ts.Node): void {
    const existing = this.typesByName.get(name) ?? [];
    existing.push({ row, start: node.getStart(this.sourceFile) });
    // Declaration order, so the nearest-preceding search below is a scan of a
    // sorted list rather than a search of whatever order the walk happened to
    // reach them in.
    existing.sort((a, b) => a.start - b.start);
    this.typesByName.set(name, existing);
  }

  /**
   * The type `name` refers to AT this reference, not the first one in the file.
   *
   * Nearest-preceding: among the declarations of that name, the last one
   * starting at or before the reference. A reference that precedes every
   * declaration falls back to the first, which is the hoisting case — a
   * `Foo.prototype.m =` above `function Foo(){}` still means that `Foo`.
   *
   * With one declaration, which is almost every file, this returns exactly what
   * the first-wins map returned. It differs only where the name is reused, which
   * is precisely where first-wins was wrong.
   */
  private typeNamedAt(name: string, reference: ts.Node): JsTypeRegistry | undefined {
    const candidates = this.typesByName.get(name);
    if (candidates === undefined || candidates.length === 0) {
      return undefined;
    }
    if (candidates.length === 1) {
      return candidates[0]!.row;
    }
    const at = reference.getStart(this.sourceFile);
    let chosen = candidates[0]!;
    for (const candidate of candidates) {
      if (candidate.start <= at) {
        chosen = candidate;
      }
    }
    return chosen.row;
  }

  /**
   * `@typedef {{a: string}} Foo` and `@callback Handler`.
   *
   * **1,825 and 103 measured — types with no declaration syntax anywhere.** The
   * row carries `evidenceKind = COMMENT_ONLY` and a `startLine` inside a
   * comment, and an FK from a `js_variable` to one of them is an ordinary FK.
   *
   * `isTypeOnly` is true and the gate asserts no call site resolves into one —
   * `@callback` names a callable shape and is exactly the row most likely to be
   * mistaken for a call target. It is not one.
   *
   * The JSDoc nodes are reached through `node.jsDoc`, where the COMPILER put
   * them: these tags are parsed into the AST and used for inference under
   * `checkJs`, which is why treating JSDoc as trivia would leave this language
   * with no declared-type channel at all.
   */
  private emitJsDocTypedefs(): void {
    const visit = (node: ts.Node): void => {
      // `ts.getJSDocTags` surfaces only the LAST attached block's tags, and a
      // file that opens with two `@typedef` comments before its first statement
      // attaches all three blocks to that one statement — measured: three blocks
      // in, one tag out. Reading `node.jsDoc` directly is the only way to see
      // them all, and it is the same internal property `ts-fact-extractor.ts`
      // reads `parseDiagnostics` from.
      for (const tag of jsDocTagsOfAllBlocks(node)) {
        if (!ts.isJSDocTypedefTag(tag) && !ts.isJSDocCallbackTag(tag)) {
          continue;
        }
        const name = tag.name === undefined ? '' : tag.name.getText(this.sourceFile);
        if (name === '') {
          continue;
        }
        if (this.typesByName.has(name)) {
          // A `@typedef` documenting a class that also exists in syntax. The
          // syntax row wins; minting a second would DOUBLE the type rather than
          // collide, and the two would disagree about `evidenceKind`.
          continue;
        }
        const at = this.positionOf(tag);
        const row = new JsTypeRegistry({
          name,
          qualifiedName: `${this.options.moduleQualifiedName}.${name}`,
          fileName: this.options.fileName,
          filePath: this.options.filePath,
          baseMservPath: this.options.baseMservPath,
          startLine: at.startLine,
          endLine: at.endLine,
          startColumn: at.startColumn,
          typeCategory: ts.isJSDocCallbackTag(tag)
            ? JsTypeCategory.JSDOC_CALLBACK
            : JsTypeCategory.JSDOC_TYPEDEF,
          declarationForm: JsTypeDeclarationForm.JSDOC_TYPEDEF,
          isAbstract: false,
          modifiers: '',
          evidenceKind: JsEvidenceKind.COMMENT_ONLY,
          isTypeOnly: true,
          ownerModuleLinkHash: this.options.moduleHash,
          ownerScopeLinkHash: this.options.hashOfScope(this.options.binder.moduleScope),
          enclosingMethodLinkHash: '',
          serviceVersionLinkHash: this.options.serviceVersionLinkHash,
        });
        this.types.push(row);
        this.recordTypeName(name, row, tag);
        this.jsDocTypeTags.push({ tag, row });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(this.sourceFile, visit);
  }

  /**
   * Names written to after they are declared.
   *
   * A same-file scan, and deliberately syntactic: it asks whether the name
   * appears as an assignment target anywhere in the file, not whether the write
   * is reachable. For a `let` or a `var` that is the difference between a
   * binding an engine may treat as constant and one it may not.
   */
  private collectReassignedNames(): Set<string> {
    const names = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left)
        && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        names.add(node.left.text);
      }
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        && ts.isIdentifier(node.operand)
        && (node.operator === ts.SyntaxKind.PlusPlusToken
          || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        names.add(node.operand.text);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(this.sourceFile, visit);
    return names;
  }

  /**
   * The method whose body scope this is, walking out to the nearest one.
   *
   * A module-level binding gets `""`, which is the honest answer: the
   * `<module>` initializer owns top-level STATEMENTS, and a name declared at the
   * top level belongs to the module rather than to a method.
   */
  private methodHashForScope(scope: JsScopeNode): string {
    for (let current: JsScopeNode | null = scope; current !== null;
      current = current.parent) {
      if (current.ownerNode === null) {
        continue;
      }
      const hash = this.methodHashByNode.get(nodeKey(current.ownerNode));
      if (hash !== undefined) {
        return hash;
      }
    }
    return '';
  }

  /**
   * The GUARD of a block, linked once the expression pass has minted its row.
   *
   * The narrowing lever: a block whose condition is not reachable as a row is a
   * block an engine cannot reason about entering. TypeScript found the same —
   * 440 type predicates measured, all useless until the guard had a hash.
   */
  private linkCondition(block: JsBlockRegistry, condition: ts.Expression): void {
    this.pendingExpressionLinks.push({
      nodeIdentity: nodeKey(condition),
      link: (hash) => {
        block.setConditionExpressionLinkHash(hash);
      },
    });
  }

  /** First-wins: the OUTERMOST node at an offset is what a comment documents. */
  private registerCommentOwner(
    node: ts.Node | undefined,
    kind: string,
    hash: string
  ): void {
    if (node === undefined) {
      return;
    }
    const start = node.getStart(this.sourceFile);
    if (!this.commentOwnerStarts.has(start)) {
      this.commentOwnerStarts.set(start, { kind, hash });
    }
  }

  /** One more member on this type, counted and written back to the row. */
  private countMember(type: JsTypeRegistry): void {
    const next = (this.memberCountByType.get(type) ?? 0) + 1;
    this.memberCountByType.set(type, next);
    type.setDeclaredMemberCount(next);
  }

  private positionOf(node: ts.Node): Position {
    return rangeOf(node, this.sourceFile);
  }
}

interface Position {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/**
 * What the walk carries down instead of re-deriving at each row.
 *
 * Owner derivation by walking `.parent` or by comparing positions picks the
 * wrong owner whenever two candidates begin at the same offset — constant in
 * JavaScript, where an IIFE's parenthesis, its function and its call all start
 * together.
 */
interface WalkContext {
  readonly scope: JsScopeNode;
  readonly ownerType: JsTypeRegistry | undefined;
  readonly ownerMethod: JsMethodRegistry | undefined;
  readonly ownerMethodQualifiedName: string;
  readonly block: JsBlockRegistry | undefined;
  /** Next child index per parent block hash. Shared, so ordering is global. */
  readonly childIndexByBlock: Map<string, number>;
}

/**
 * Block forms handled by the generic path.
 *
 * `if` and `try` are deliberately ABSENT: each mints more than one row — an
 * `else` arm and a `finally` body are blocks of their own — so they have
 * dedicated visitors. Leaving them here as well would visit them on two paths,
 * and a construct visited twice DOUBLES its rows rather than colliding.
 */
function isBlockLike(node: ts.Node): boolean {
  return ts.isBlock(node) || ts.isForStatement(node)
    || ts.isForInStatement(node) || ts.isForOfStatement(node)
    || ts.isWhileStatement(node) || ts.isDoStatement(node)
    || ts.isCatchClause(node)
    || ts.isSwitchStatement(node) || ts.isCaseClause(node)
    || ts.isDefaultClause(node) || ts.isLabeledStatement(node);
}

function blockKindOf(node: ts.Node): JsBlockKind {
  if (ts.isForStatement(node)) {
    return JsBlockKind.FOR;
  }
  if (ts.isForInStatement(node)) {
    return JsBlockKind.FOR_IN;
  }
  if (ts.isForOfStatement(node)) {
    return JsBlockKind.FOR_OF;
  }
  if (ts.isWhileStatement(node)) {
    return JsBlockKind.WHILE;
  }
  if (ts.isDoStatement(node)) {
    return JsBlockKind.DO;
  }
  if (ts.isCatchClause(node)) {
    return JsBlockKind.CATCH;
  }
  if (ts.isSwitchStatement(node)) {
    return JsBlockKind.SWITCH;
  }
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
    return JsBlockKind.SWITCH_CASE;
  }
  if (ts.isLabeledStatement(node)) {
    return JsBlockKind.LABELED;
  }
  return JsBlockKind.BLOCK;
}

/** The expression a block is guarded by, where it has one. */
function conditionOf(node: ts.Node): ts.Expression | undefined {
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)
    || ts.isSwitchStatement(node)) {
    return node.expression;
  }
  if (ts.isForStatement(node)) {
    return node.condition;
  }
  if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    return node.expression;
  }
  if (ts.isCaseClause(node)) {
    return node.expression;
  }
  return undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function modifiersOf(node: ts.Node): string {
  if (!ts.canHaveModifiers(node)) {
    return '';
  }
  return (ts.getModifiers(node) ?? [])
    .map((modifier) => ts.tokenToString(modifier.kind) ?? '')
    .filter((text) => text !== '')
    .sort()
    .join(',');
}

/**
 * `this` inside this callable.
 *
 * An arrow is `LEXICAL` — it inherits `this` from where it was written, which is
 * what makes `this.f()` work inside a callback. A class method is `DYNAMIC`
 * despite appearing bound, because detaching it (`const m = obj.method`) loses
 * the receiver, and that detachment is the single most common source of
 * `undefined` receivers in real code.
 */
/**
 * The type NAME an owner expression refers to, for a prototype assignment.
 *
 * `Foo.prototype.m = …` names `Foo` with an identifier. `exports.F.prototype.m = …`
 * names it with a property access, and that spelling is how a library that
 * assigns its constructor straight onto `exports` writes every one of its
 * methods. Matching only the identifier left those members as anonymous function
 * expressions owned by nothing.
 *
 * The TAIL name is what is used, and only the tail: `exports.F` and `Foo.F` both
 * name `F`. That is the same lookup `typesByName` already performs for the
 * identifier case — resolved to the nearest preceding declaration — so it
 * introduces no new ambiguity, and the caller still has to find a type actually
 * declared in this file before anything is emitted.
 */
function typeNameOfExpression(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  return undefined;
}

/**
 * The NAMES a function expression is bound to, for every shape that binds one.
 *
 * ## Why this is a list of shapes rather than a rule
 *
 * A constructor function is recognised from evidence — `new X`, `X.prototype`,
 * `util.inherits(X, …)`, a body assigning to `this`. That evidence names an
 * IDENTIFIER. Finding the callable that identifier refers to is the other half,
 * and before this the only shape it could follow was `function X() {}`.
 *
 * Four shapes, all measured in the corpus and all previously lost:
 *
 * ```js
 * var B = function (x) {};              // anonymous, bound by a declaration
 * var C = function C(x) {};             // named function expression
 * exports.F = function (x) {};          // bound to a property, never to a local
 * var E = exports.E = function (x) {};  // both at once — the 2015-era spelling
 * ```
 *
 * The last is why the chain is followed rather than matched: `var E = <assign>`
 * has a BinaryExpression initializer whose right side is the callable, and both
 * `E` and the property name are names the same function answers to.
 *
 * ## An arrow is deliberately absent
 *
 * `var B = () => {}` cannot be a constructor: an arrow has no `[[Construct]]`
 * and `new B()` is a TypeError. Including it would mint a js_type for something
 * the language forbids instantiating.
 */
function constructorBindingsOf(
  node: ts.Node
): ReadonlyArray<{ name: string; callable: ts.FunctionExpression }> {
  const out: { name: string; callable: ts.FunctionExpression }[] = [];

  // `var B = <callable>` and `var E = exports.E = <callable>`.
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
    && node.initializer !== undefined) {
    const callable = callableThroughAssignments(node.initializer);
    if (callable !== undefined) {
      out.push({ name: node.name.text, callable });
    }
  }

  // `exports.F = <callable>`, `Foo.Bar = <callable>`, and the inner half of the
  // chained form above.
  if (ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const callable = callableThroughAssignments(node.right);
    if (callable !== undefined && ts.isPropertyAccessExpression(node.left)) {
      out.push({ name: node.left.name.text, callable });
    }
    if (callable !== undefined && ts.isIdentifier(node.left)) {
      out.push({ name: node.left.text, callable });
    }
  }
  return out;
}

/** Follows `a = b = <callable>` to the callable, if one is at the end. */
function callableThroughAssignments(
  node: ts.Expression
): ts.FunctionExpression | undefined {
  let current: ts.Expression = node;
  for (;;) {
    if (ts.isFunctionExpression(current)) {
      return current;
    }
    if (ts.isBinaryExpression(current)
      && current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      current = current.right;
      continue;
    }
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    return undefined;
  }
}

function thisBindingFor(kind: JsMethodKind): JsThisBinding {
  if (kind === JsMethodKind.ARROW) {
    return JsThisBinding.LEXICAL;
  }
  if (kind === JsMethodKind.MODULE_INITIALIZER) {
    return JsThisBinding.NONE;
  }
  return JsThisBinding.DYNAMIC;
}

function bodyPresenceOf(body: ts.Node | undefined): JsBodyPresence {
  if (body === undefined) {
    return JsBodyPresence.NO_BODY;
  }
  // A concise arrow's body is an EXPRESSION, so its implicit return has no
  // `return` statement to find. An extractor looking for ReturnStatement nodes
  // finds none and reports a function returning nothing.
  return ts.isBlock(body) ? JsBodyPresence.HAS_BODY : JsBodyPresence.EXPRESSION_BODY;
}

/**
 * Does this body reference `arguments`?
 *
 * Stops at every nested `function`, because `arguments` inside one refers to
 * *that* function's arguments. It does **not** stop at an arrow, because an
 * arrow has no `arguments` of its own and reading it there reaches the
 * enclosing function's — which means the enclosing function really does use it.
 */
function referencesArguments(body: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
      || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
      return;
    }
    if (ts.isIdentifier(node) && node.text === 'arguments') {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/** Does this body contain a `this.x = …`? Evidence of a constructor function. */
function bodyAssignsToThis(body: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
      || ts.isClassLike(node)) {
      return;
    }
    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && node.left.expression.kind === ts.SyntaxKind.ThisKeyword) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/**
 * The declared type of a position, from JSDoc — the only declared-type channel
 * JavaScript has.
 *
 * 37.9% of parameters carry one and effectively none carry a syntactic one, all 64
 * of which are Flow. The NAME is read here as a string, because a declaration
 * row needs it at construction; the TREE it describes is emitted separately by
 * `js-jsdoc-extractor.ts` and linked back, because a type expression is three
 * rows and not a string.
 */
export function declaredTypeFromJsDoc(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  kind: 'type' | 'returns' | 'param'
): { name: string; source: JsDeclaredTypeSource } {
  const tag = kind === 'returns'
    ? ts.getJSDocReturnTag(node)
    : kind === 'type'
      ? ts.getJSDocTypeTag(node)
      // The SHARED selection, not `getJSDocParameterTags(node)[0]`. That took
      // the first tag the compiler associated with the parameter, which on a
      // nested `@param {object} ctx.model` was the wrong tag entirely — and it
      // disagreed with the path that builds the type-reference tree, 300 times
      // over the corpus.
      : jsDocParameterTagFor(node as ts.ParameterDeclaration);
  const type = tag?.typeExpression?.type;
  if (type !== undefined) {
    return {
      name: typeNameAsWritten(type, sourceFile),
      source: JsDeclaredTypeSource.JSDOC,
    };
  }
  // A SYNTACTIC annotation in a .js file is Flow, not TypeScript — all 64
  // measured are. `ts.createSourceFile` parses the overlapping grammar into real
  // `.type` nodes and mis-parses the rest SILENTLY, so recording which grammar
  // it came from is what stops a later reader treating one as the other.
  const syntactic = (node as { type?: ts.TypeNode }).type;
  if (syntactic !== undefined) {
    return {
      name: typeNameAsWritten(syntactic, sourceFile),
      source: JsDeclaredTypeSource.SYNTACTIC_FLOW,
    };
  }
  return { name: '', source: JsDeclaredTypeSource.NONE };
}

/**
 * The name WITHOUT type arguments and without JSDoc's modifier syntax.
 *
 * `@param {number=}` names `number`, not `number=`; `@param {...Options}` names
 * `Options`; `@type {?Options}` names `Options`. The optionality, the rest-ness
 * and the nullability are all modelled as `js_type_reference` rows of their own,
 * so carrying them in the NAME too would mean a consumer doing string surgery to
 * recover a name the fact base already holds — and getting it wrong on the first
 * `Array<?T>`.
 */
function typeNameAsWritten(type: ts.Node, sourceFile: ts.SourceFile): string {
  let current: ts.Node = type;
  for (;;) {
    if (ts.isJSDocOptionalType(current) || ts.isJSDocVariadicType(current)
      || ts.isJSDocNullableType(current) || ts.isJSDocNonNullableType(current)) {
      current = current.type;
      continue;
    }
    break;
  }
  if (ts.isTypeReferenceNode(current)) {
    return current.typeName.getText(sourceFile);
  }
  if (ts.isJSDocTypeLiteral(current)) {
    // `@param {object} ctx` followed by `@param {string} ctx.model`: the
    // compiler REPLACES the parent's `{object}` with a synthesised type
    // literal whose text is the child tags — so getText() here was the raw
    // remaining comment, sibling tags and asterisks included, on every dotted
    // parent (js-fixtures' nested-params, six shapes). The name as WRITTEN is
    // the first brace group of the tag that carries the literal.
    let tag: ts.Node | undefined = current.parent;
    while (tag !== undefined && !ts.isJSDocParameterTag(tag) && !ts.isJSDocPropertyTag(tag)
      && !ts.isJSDocTypedefTag(tag) && !ts.isJSDocTypeTag(tag)) {
      tag = tag.parent;
    }
    const written = tag === undefined ? undefined : /\{([^}]*)\}/.exec(tag.getText(sourceFile));
    return written?.[1]?.trim() ?? '';
  }
  // An import type keeps its FULL text here — `import("./x").Y` — because the
  // declaration row has one name column and the specifier is the part that
  // says which file. The reference row names the qualifier and links the
  // specifier's js_import row (§3.14.4).
  return current.getText(sourceFile);
}

function propertyNameText(name: ts.PropertyName | undefined): string {
  if (name === undefined) {
    return '';
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  return '';
}

function isObjectCreate(call: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(call.expression)
    && call.expression.name.text === 'create'
    && ts.isIdentifier(call.expression.expression)
    && call.expression.expression.text === 'Object';
}

/** `Parent.prototype` -> `Parent`; anything else stays as it is. */
function prototypeOwnerOf(node: ts.Expression): ts.Expression | undefined {
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'prototype') {
    return node.expression;
  }
  return undefined;
}

function countPatternBindings(name: ts.BindingName): number {
  if (ts.isIdentifier(name)) {
    return 1;
  }
  let total = 0;
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }
    total += countPatternBindings(element.name);
  }
  return total;
}

function bindingFormOf(declaration: ts.Node | undefined): JsVariableBindingForm {
  if (declaration === undefined) {
    return JsVariableBindingForm.IDENTIFIER;
  }
  const name = ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)
    ? declaration.name
    : undefined;
  if (name === undefined || ts.isIdentifier(name)) {
    return JsVariableBindingForm.IDENTIFIER;
  }
  return ts.isObjectBindingPattern(name)
    ? JsVariableBindingForm.OBJECT_PATTERN
    : JsVariableBindingForm.ARRAY_PATTERN;
}

/**
 * What a binding was initialised with, coarsely.
 *
 * `REQUIRE_CALL` is the value that matters — 34.4% of all oracle declines are
 * calls through a name bound this way, and this column plus `importLinkHash` is
 * what turns them from unresolvable into reconstructable.
 */
function initializerKindOf(initializer: ts.Expression | undefined): JsInitializerKind {
  if (initializer === undefined) {
    return JsInitializerKind.NONE;
  }
  if (isRequireCall(initializer)) {
    return JsInitializerKind.REQUIRE_CALL;
  }
  if (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) {
    return JsInitializerKind.FUNCTION;
  }
  if (ts.isClassExpression(initializer)) {
    return JsInitializerKind.CLASS;
  }
  if (ts.isObjectLiteralExpression(initializer)) {
    return JsInitializerKind.OBJECT_LITERAL;
  }
  return JsInitializerKind.OTHER;
}

/**
 * Is this bound name introduced by an `import` declaration?
 *
 * Covers all three spellings, because all three bind a module alias:
 * `import d from 'm'`, `import { n } from 'm'` and `import * as ns from 'm'`.
 * The walk stops at the declaration rather than running to the source file, so
 * a name inside an imported function's body cannot be mistaken for one.
 */
function isImportBindingName(nameNode: ts.Node): boolean {
  let current: ts.Node | undefined = nameNode;
  while (current !== undefined) {
    if (ts.isImportSpecifier(current) || ts.isImportClause(current)
      || ts.isNamespaceImport(current) || ts.isImportEqualsDeclaration(current)) {
      return true;
    }
    if (ts.isVariableDeclaration(current) || ts.isParameter(current)
      || ts.isSourceFile(current) || ts.isStatement(current)) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

/**
 * The DECLARATOR a bound name belongs to: the node whose end bounds where the
 * value is constructed. Walks up out of any destructuring pattern first, so
 * `const {a, b} = make()` ends where `make()` does for both names.
 */
function declaratorOf(nameNode: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = nameNode;
  while (current !== undefined) {
    if (ts.isVariableDeclaration(current) || ts.isFunctionDeclaration(current)
      || ts.isClassDeclaration(current) || ts.isImportSpecifier(current)
      || ts.isImportClause(current) || ts.isNamespaceImport(current)
      || ts.isCatchClause(current)) {
      return current;
    }
    if (ts.isSourceFile(current) || ts.isStatement(current)) {
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * The `VariableDeclaration` or parameter a bound name belongs to — and
 * `undefined` for a name that belongs to something else.
 *
 * ## It climbed past the name's own declarator, and everything it found was
 * someone else's
 *
 * This walked up to the NEAREST VariableDeclaration with no stop, so a
 * `function inner() {}` declared inside `const controller = { … }` was
 * handed `controller`'s declaration: its `@type` (a JSDoc import type,
 * minted once per nested declaration — the held-back corpus's first
 * duplicate js_import key, and three js_type_reference rows for one comment
 * that the PK and FK gates both passed because each had a distinct owner),
 * its initialiser (`hasInitializer = true` on 972 function declarations and
 * 20 classes in the development corpus, with the enclosing initialiser's
 * expression as their link), and its binding form (11 declarations reading
 * OBJECT_PATTERN). A comment re-hosted DOWNWARD; every prior host question
 * was about missing rows. The walk now stops at the first declarator the
 * name has — a function or class declaration, a catch clause, an import —
 * and answers only when that declarator is a variable or a parameter.
 */
function declarationOwning(nameNode: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = nameNode;
  while (current !== undefined) {
    if (ts.isVariableDeclaration(current) || ts.isParameter(current)) {
      return current;
    }
    if (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)
      || ts.isCatchClause(current) || ts.isImportSpecifier(current) || ts.isImportClause(current)
      || ts.isNamespaceImport(current) || ts.isSourceFile(current) || ts.isStatement(current)
      || ts.isFunctionLike(current) || ts.isClassLike(current)) {
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

/** Kept so a caller can name a file without re-deriving it. */
export function fileNameOf(filePath: string): string {
  return path.basename(filePath);
}
