import * as path from 'path';

import Parser from 'tree-sitter';

import { PyBindingRegistry, PyModuleRegistry, PyScopeRegistry } from '@/analysis-types/python';
import {
  PYTHON_MODULE_SCOPE_NAME,
  PYTHON_TARGET_VERSION,
} from '@/constants/python-constants';
import {
  PythonBindingKind,
  PythonBindingOrigin,
} from '@/enums/python/bindings';
import {
  PythonDialect,
  PythonEmissionRegime,
  PythonGrammarUsed,
  PythonModuleKind,
} from '@/enums/python/modules';
import { PythonScopeKind, PythonScopeOwnerKind, SymbolBlockType } from '@/enums/python/scopes';
import { PythonDialectDetector } from '@/parsers/python/python-dialect-detector';
import { PythonParser } from '@/parsers/python/python-parser';
import { PythonScopeBuilder } from '@/parsers/python/extractors/python-scope-builder';
import {
  analyzeSymbolTable,
  DEF_BOUND,
  isOptimized,
  SymbolFlags,
  SymbolScope,
} from '@/parsers/python/extractors/python-symbol-table';
import { Python2Finding, SymbolBlock } from '@/types/python';
import { PythonSourcePositions } from '@/utils/python';

/** Everything the scope/binding stage produces for one file. */
export interface PythonModuleExtraction {
  /** `undefined` when the file was rejected — no facts are emitted at all. */
  module?: PyModuleRegistry;
  scopes: PyScopeRegistry[];
  bindings: PyBindingRegistry[];
  /** The detected dialect. `PY2_DETECTED_REJECTED` means everything above is empty. */
  dialect: PythonDialect;
  /** Python 2 constructs found, for `py_parse_gap` and `skipped-python-files.csv`. */
  python2Findings: Python2Finding[];

  /**
   * The parsed root, carried so the declaration stage does not re-parse. Files
   * over 32,767 characters are expensive to parse and re-parsing would also
   * risk the two stages disagreeing about the tree.
   */
  rootNode?: Parser.SyntaxNode;
  /**
   * Scope-introducing `node.id` -> the `py_scope` PK for that node.
   *
   * This is how declarations link to scopes without re-deriving a qualified
   * name. Keyed on `node.id` rather than tagged onto the node itself, because
   * node-tree-sitter's wrapper cache evicts entries and a tag would silently
   * vanish between stages.
   */
  scopeHashByNodeId: Map<number, string>;
  /** Scope-introducing `node.id` -> the analysed symbol-table block. */
  blocksByNodeId: Map<number, SymbolBlock>;
  /** `(scopeHash, name)` -> binding PK, so declarations can link their bindings. */
  bindingHashByScopeAndName: Map<string, string>;
  /**
   * Scope-introducing `node.id` -> the scope's qualified name.
   *
   * Declarations reuse this rather than re-deriving `__qualname__`, so a class
   * and its scope can never disagree about their own name.
   */
  qualifiedNameByNodeId: Map<number, string>;
}

export interface PythonExtractionInput {
  sourceCode: string;
  /** Repo-relative path, used verbatim in `filePath`. */
  filePath: string;
  /** Service root, the Java convention. */
  baseMservPath: string;
  /** Dotted module name. Defaults to the file's basename. */
  moduleQualifiedName?: string;
  serviceVersionLinkHash: string;
  emissionRegime?: PythonEmissionRegime;
}

/**
 * Emits the scope/binding spine — `py_module`, `py_scope`, `py_binding` — for one
 * Python file.
 *
 * This is stage 1 of the build order and the only stage CPython adjudicates
 * **exactly**: `symtable` is ground truth for the scope tree, for every
 * `(scope, name)` pair, and for all eleven `Symbol` predicates. So this is where
 * we find out whether the implementation is right, rather than merely plausible.
 *
 * ## Order of operations, and why rejection comes first
 *
 * 1. Parse (the parser owns the 32,767-character workaround).
 * 2. **Detect dialect.** If any Python 2 construct is found, emit **nothing** —
 *    no module row, no scopes, no bindings — and return the findings so the
 *    caller can write `skipped-python-files.csv` and `py_parse_gap` rows.
 * 3. Build the symbol table (pass 1), then analyse it (pass 2).
 * 4. Emit rows in a deterministic pre-order.
 *
 * Rejection precedes emission because a Python 2 file parses *cleanly*: there is
 * no error to catch downstream, so anything emitted before the check would be a
 * confident wrong answer.
 *
 * ## Determinism
 *
 * Rows are accumulated and exported in a total order — scopes in scope-tree
 * pre-order with siblings in source order, bindings sorted by name within each
 * scope. Byte-identical output across runs is a gate, not a nicety, so nothing
 * here depends on `Map` iteration order that a caller could perturb.
 */
export class PythonScopeExtractor {
  private parser: PythonParser;
  private detector: PythonDialectDetector;

  constructor(parser?: PythonParser, detector?: PythonDialectDetector) {
    this.parser = parser ?? new PythonParser();
    this.detector = detector ?? new PythonDialectDetector();
  }

  extract(input: PythonExtractionInput): PythonModuleExtraction {
    const regime = input.emissionRegime ?? PythonEmissionRegime.PY3_0_11;
    if (regime !== PythonEmissionRegime.PY3_0_11) {
      // The 3.12 regime differs structurally at every list/set/dict
      // comprehension (PEP 709). There is no pinned 3.12 oracle, so emitting
      // under it would produce facts nothing can adjudicate. Refusing is the
      // honest failure; guessing is not.
      throw new Error(
        `emissionRegime ${regime} is not implemented: only PY3_0_11 is verified against the pinned oracle`
      );
    }

    const tree = this.parser.parse(input.sourceCode);
    const rootNode = this.parser.getRootNode(tree);

    const detection = this.detector.detect(rootNode, input.sourceCode);
    if (detection.dialect !== PythonDialect.PY3) {
      return {
        scopes: [],
        bindings: [],
        dialect: detection.dialect,
        python2Findings: detection.findings,
        scopeHashByNodeId: new Map(),
        blocksByNodeId: new Map(),
        bindingHashByScopeAndName: new Map(),
        qualifiedNameByNodeId: new Map(),
        positions: new PythonSourcePositions(input.sourceCode),
      };
    }

    const moduleQualifiedName =
      input.moduleQualifiedName ?? this.deriveModuleQualifiedName(input.filePath);

    const positions = new PythonSourcePositions(input.sourceCode);

    const builder = new PythonScopeBuilder();
    const rootBlock = builder.build(rootNode, moduleQualifiedName, positions);
    analyzeSymbolTable(rootBlock);

    const module = this.buildModuleRow(input, rootNode, moduleQualifiedName, regime);

    const scopes: PyScopeRegistry[] = [];
    const bindings: PyBindingRegistry[] = [];
    const scopeHashByNodeId = new Map<number, string>();
    const bindingHashByScopeAndName = new Map<string, string>();
    this.emitBlock(rootBlock, module, '', input, scopes, bindings, { nextSymtableId: 0 }, {
      scopeHashByNodeId,
      bindingHashByScopeAndName,
    });

    // The module row is minted before its scope exists, so the FK is patched in.
    const moduleScope = scopes[0];
    if (moduleScope) {
      module.setModuleScopeLinkHash(moduleScope.getHash());
    }

    return {
      module,
      scopes,
      bindings,
      dialect: detection.dialect,
      python2Findings: [],
      rootNode,
      scopeHashByNodeId,
      blocksByNodeId: builder.getBlocksByNodeId(),
      bindingHashByScopeAndName,
      qualifiedNameByNodeId: this.collectQualifiedNames(builder.getBlocksByNodeId()),
      positions,
    };
  }

  /** Snapshots each block's qualified name, keyed by its introducing node. */
  private collectQualifiedNames(
    blocksByNodeId: Map<number, SymbolBlock>
  ): Map<number, string> {
    const names = new Map<number, string>();
    for (const [nodeId, block] of blocksByNodeId) {
      names.set(nodeId, block.qualifiedName);
    }
    return names;
  }

  // -------------------------------------------------------------- emission

  /**
   * Emits one block and recurses, in pre-order with siblings in source order.
   *
   * The `symtableId` counter is a canonical pre-order ordinal rather than
   * CPython's `get_id()`, which is a heap address and varies run to run.
   */
  private emitBlock(
    block: SymbolBlock,
    module: PyModuleRegistry,
    parentScopeHash: string,
    input: PythonExtractionInput,
    scopes: PyScopeRegistry[],
    bindings: PyBindingRegistry[],
    counter: { nextSymtableId: number },
    links: {
      scopeHashByNodeId: Map<number, string>;
      bindingHashByScopeAndName: Map<string, string>;
    }
  ): void {
    const scope = PyScopeRegistry.builder(
      block.scopeKind,
      block.name,
      block.qualifiedName,
      module.getHash(),
      input.filePath,
      block.startLine,
      block.startColumn,
      input.serviceVersionLinkHash
    )
      .withParent(parentScopeHash, block.nestingDepth)
      .withSymtablePredicates(block.isNested, isOptimized(block), block.children.length > 0)
      .withSymtableId(counter.nextSymtableId++)
      .withFlags({
        usesWildcardImport: block.usesWildcardImport,
        isGenerator: block.isGenerator,
        isCoroutine: block.isCoroutine,
        declaresGlobal: block.declaresGlobal,
        declaresNonlocal: block.declaresNonlocal,
      })
      .withEndPosition(block.endLine, block.endColumn)
      .withScopeOrdinal(block.scopeOrdinal)
      .withOwner(this.ownerKindFor(block), '')
      .build();

    scopes.push(scope);
    links.scopeHashByNodeId.set(block.nodeId, scope.getHash());
    this.emitBindings(block, scope, module, input, bindings, links.bindingHashByScopeAndName);

    for (const child of block.children) {
      this.emitBlock(child, module, scope.getHash(), input, scopes, bindings, counter, links);
    }
  }

  /**
   * Emits one `py_binding` row per `(scope, name)`.
   *
   * Names are sorted so that output is byte-identical across runs regardless of
   * the order pass 1 happened to encounter them in.
   */
  private emitBindings(
    block: SymbolBlock,
    scope: PyScopeRegistry,
    module: PyModuleRegistry,
    input: PythonExtractionInput,
    bindings: PyBindingRegistry[],
    bindingHashByScopeAndName: Map<string, string>
  ): void {
    const names = Array.from(block.symbols.keys()).sort();
    const childNames = new Set(block.children.map(child => child.name));

    for (const name of names) {
      const flags = block.symbols.get(name) ?? 0;
      const symbolScope = block.scopes.get(name) ?? SymbolScope.NONE;
      const origin = block.origins.get(name);

      // CPython's `symtable.py` decides "is this module scope?" by comparing the
      // table's NAME to "top", not by checking its type:
      //
      //     module_scope = (self._table.name == "top")
      //
      // So a function or class literally named `top` gets module-scope
      // semantics for is_local/is_global. That is surprising, and arguably a
      // CPython wart, but symtable is the oracle: `poplib.POP3.top` reports its
      // parameters as is_global=true, and matching CPython means reproducing it.
      const isModuleScope = block.name === PYTHON_MODULE_SCOPE_NAME;

      // The eleven predicates, computed exactly as `symtable.Symbol` does.
      // The module-scope special case in is_local/is_global is CPython's own: a
      // bound name at module level is simultaneously local and global.
      const boundAtModuleScope = isModuleScope && (flags & DEF_BOUND) !== 0;
      const predicates = {
        isParameter: (flags & SymbolFlags.DEF_PARAM) !== 0,
        isLocal:
          symbolScope === SymbolScope.LOCAL ||
          symbolScope === SymbolScope.CELL ||
          boundAtModuleScope,
        isGlobal:
          symbolScope === SymbolScope.GLOBAL_IMPLICIT ||
          symbolScope === SymbolScope.GLOBAL_EXPLICIT ||
          boundAtModuleScope,
        isNonlocal: (flags & SymbolFlags.DEF_NONLOCAL) !== 0,
        isFree: symbolScope === SymbolScope.FREE,
        isImported: (flags & SymbolFlags.DEF_IMPORT) !== 0,
        isAssigned: (flags & SymbolFlags.DEF_LOCAL) !== 0,
        isReferenced: (flags & SymbolFlags.USE) !== 0,
        isDeclaredGlobal: symbolScope === SymbolScope.GLOBAL_EXPLICIT,
        isAnnotated: (flags & SymbolFlags.DEF_ANNOT) !== 0,
        // `is_namespace` is true when the name binds a def or class *here* —
        // CPython tests whether any child symbol table carries this name. A
        // lambda bound as `f = lambda: 1` does NOT qualify: its child table is
        // named `lambda`, not `f`.
        isNamespace: childNames.has(name),
      };

      const binding = PyBindingRegistry.builder(
        name,
        scope.getHash(),
        module.getHash(),
        input.filePath,
        input.serviceVersionLinkHash
      )
        .withKindAndOrigin(
          this.bindingKindFor(block, flags, symbolScope, predicates.isParameter),
          this.bindingOriginFor(origin)
        )
        .withSymbolPredicates(predicates)
        .withBindingSites(
          origin?.bindingCount ?? 0,
          origin?.firstLine ?? 0,
          origin?.lastLine ?? 0
        )
        .withDeclaredType(origin?.declaredTypeName ?? '', '', '', false)
        .build();

      bindings.push(binding);
      bindingHashByScopeAndName.set(`${scope.getHash()}::${name}`, binding.getHash());
    }
  }

  /**
   * Maps a resolved symbol scope to `py_binding.bindingKind`.
   *
   * The order of these tests matters: a parameter is also `LOCAL` by scope, and
   * an imported name is also bound, so the more specific answer has to win.
   */
  private bindingKindFor(
    block: SymbolBlock,
    flags: number,
    symbolScope: number,
    isParameter: boolean
  ): PythonBindingKind {
    if (symbolScope === SymbolScope.GLOBAL_EXPLICIT) {
      return PythonBindingKind.GLOBAL_EXPLICIT;
    }
    if (symbolScope === SymbolScope.GLOBAL_IMPLICIT) {
      return PythonBindingKind.GLOBAL_IMPLICIT;
    }
    if ((flags & SymbolFlags.DEF_NONLOCAL) !== 0) {
      return PythonBindingKind.NONLOCAL;
    }
    if (symbolScope === SymbolScope.FREE) {
      return PythonBindingKind.FREE;
    }
    if (isParameter) {
      return PythonBindingKind.PARAMETER;
    }
    if ((flags & SymbolFlags.DEF_IMPORT) !== 0) {
      return PythonBindingKind.IMPORTED;
    }
    if (symbolScope === SymbolScope.CELL) {
      return PythonBindingKind.CELL;
    }
    if (block.blockType === SymbolBlockType.MODULE) {
      return PythonBindingKind.MODULE_LEVEL;
    }
    if (block.blockType === SymbolBlockType.CLASS) {
      return PythonBindingKind.CLASS_ATTRIBUTE;
    }
    if (symbolScope === SymbolScope.LOCAL) {
      // An annotation with no value and no assignment anywhere.
      if ((flags & SymbolFlags.DEF_ANNOT) !== 0 && (flags & SymbolFlags.DEF_LOCAL) === 0) {
        return PythonBindingKind.ANNOTATED_ONLY;
      }
      return PythonBindingKind.LOCAL;
    }
    return PythonBindingKind.UNKNOWN;
  }

  /**
   * Collapses the recorded syntactic origins into one value.
   *
   * A name bound by two different forms in one scope reports `MULTIPLE` rather
   * than arbitrarily picking the first, because "which form" is then genuinely
   * not a single fact.
   */
  private bindingOriginFor(origin?: {
    origins: Set<PythonBindingOrigin>;
  }): PythonBindingOrigin {
    if (!origin || origin.origins.size === 0) {
      // No binding site in this scope: the name is a read, or a free variable
      // spliced in from a child.
      return PythonBindingOrigin.ASSIGNMENT;
    }
    if (origin.origins.size > 1) {
      return PythonBindingOrigin.MULTIPLE;
    }
    const [only] = origin.origins;
    return only ?? PythonBindingOrigin.ASSIGNMENT;
  }

  private ownerKindFor(block: SymbolBlock): PythonScopeOwnerKind {
    switch (block.scopeKind) {
      case PythonScopeKind.MODULE: {
        return PythonScopeOwnerKind.MODULE;
      }
      case PythonScopeKind.CLASS: {
        return PythonScopeOwnerKind.TYPE;
      }
      case PythonScopeKind.LAMBDA: {
        return PythonScopeOwnerKind.LAMBDA;
      }
      case PythonScopeKind.COMPREHENSION_LIST:
      case PythonScopeKind.COMPREHENSION_SET:
      case PythonScopeKind.COMPREHENSION_DICT:
      case PythonScopeKind.GENERATOR_EXPRESSION: {
        return PythonScopeOwnerKind.COMPREHENSION;
      }
      default: {
        return PythonScopeOwnerKind.METHOD;
      }
    }
  }

  // ---------------------------------------------------------------- module

  private buildModuleRow(
    input: PythonExtractionInput,
    rootNode: Parser.SyntaxNode,
    moduleQualifiedName: string,
    regime: PythonEmissionRegime
  ): PyModuleRegistry {
    const fileName = path.basename(input.filePath);
    const isStub = fileName.endsWith('.pyi');
    const isPackage = fileName === '__init__.py' || fileName === '__init__.pyi';
    const segments = moduleQualifiedName.split('.');
    const name = segments[segments.length - 1] ?? moduleQualifiedName;
    const packageQualifiedName = segments.slice(0, -1).join('.');

    const moduleKind = this.moduleKindFor(rootNode, isPackage, isStub);
    const dunderAll = this.readDunderAll(rootNode);

    return PyModuleRegistry.builder(
      name,
      moduleQualifiedName,
      fileName,
      input.filePath,
      input.baseMservPath,
      moduleKind,
      regime,
      PYTHON_TARGET_VERSION,
      input.serviceVersionLinkHash
    )
      .withPackage(packageQualifiedName, isPackage)
      .withIsStub(isStub)
      .withDialect(PythonDialect.PY3)
      .withGrammarUsed(
        rootNode.hasError ? PythonGrammarUsed.TS_PYTHON3_PARTIAL : PythonGrammarUsed.TS_PYTHON3
      )
      .withFutureImports(this.readFutureImports(rootNode))
      .withEncodingDeclared(this.readEncodingCookie(input.sourceCode))
      .withHasModuleDocstring(this.hasModuleDocstring(rootNode))
      .withDunderAll(dunderAll.present, dunderAll.isStatic, dunderAll.names)
      .build();
  }

  /** Falls back to the file's basename, matching the oracle's own default. */
  private deriveModuleQualifiedName(filePath: string): string {
    const base = path.basename(filePath);
    return base.replace(/\.pyi?$/, '');
  }

  private moduleKindFor(
    rootNode: Parser.SyntaxNode,
    isPackage: boolean,
    isStub: boolean
  ): PythonModuleKind {
    if (isStub) {
      return PythonModuleKind.STUB;
    }
    if (isPackage) {
      return PythonModuleKind.PACKAGE_INIT;
    }
    if (this.hasMainGuard(rootNode)) {
      return PythonModuleKind.MAIN_GUARD_SCRIPT;
    }
    return PythonModuleKind.MODULE;
  }

  /** `if __name__ == "__main__":` at module level. */
  private hasMainGuard(rootNode: Parser.SyntaxNode): boolean {
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i);
      if (child?.type !== 'if_statement') {
        continue;
      }
      const condition = child.childForFieldName('condition');
      if (condition && condition.text.includes('__name__')) {
        return true;
      }
    }
    return false;
  }

  private hasModuleDocstring(rootNode: Parser.SyntaxNode): boolean {
    const first = rootNode.namedChild(0);
    if (first?.type !== 'expression_statement') {
      return false;
    }
    return first.namedChild(0)?.type === 'string';
  }

  /**
   * `from __future__ import annotations` and friends.
   *
   * Still load-bearing on Python 3: PEP 563 decides whether annotations are
   * strings at runtime, which changes what a type reference means.
   */
  private readFutureImports(rootNode: Parser.SyntaxNode): string[] {
    const futures: string[] = [];
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i);
      // tree-sitter-python gives `from __future__ import x` its OWN node type,
      // `future_import_statement`, rather than the ordinary
      // `import_from_statement`. Matching only the ordinary one meant this
      // returned empty for every file in existence — the grammar never produces
      // the shape it was looking for.
      if (child?.type !== 'future_import_statement' && child?.type !== 'import_from_statement') {
        continue;
      }
      const moduleName = child.childForFieldName('module_name');
      if (child.type === 'import_from_statement' && moduleName?.text !== '__future__') {
        continue;
      }
      for (let j = 0; j < child.namedChildCount; j++) {
        const member = child.namedChild(j);
        if (member && member.id !== moduleName?.id && member.type === 'dotted_name') {
          futures.push(member.text);
        }
      }
    }
    return futures;
  }

  /** PEP 263 encoding cookie, which may appear on either of the first two lines. */
  private readEncodingCookie(sourceCode: string): string {
    const lines = sourceCode.split('\n', 2);
    for (const line of lines) {
      const match = /coding[:=]\s*([-\w.]+)/.exec(line);
      if (match && line.trimStart().startsWith('#')) {
        return match[1] ?? '';
      }
    }
    return '';
  }

  /**
   * Reads `__all__`.
   *
   * `isStatic` is false when `__all__` is anything other than a list or tuple of
   * string literals — `__all__ = __all__ + _d` and `__all__.extend(...)` both
   * occur in real code. At roughly 3% of modules this is small, but treating a
   * dynamically built `__all__` as authoritative is wrong in exactly the
   * direction that hides public API, so it is flagged rather than guessed.
   */
  private readDunderAll(rootNode: Parser.SyntaxNode): {
    present: boolean;
    isStatic: boolean;
    names: string[];
  } {
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const statement = rootNode.namedChild(i);
      if (statement?.type !== 'expression_statement') {
        continue;
      }
      const assignment = statement.namedChild(0);
      if (
        assignment?.type !== 'assignment' ||
        assignment.childForFieldName('left')?.text !== '__all__'
      ) {
        continue;
      }
      const value = assignment.childForFieldName('right');
      if (!value || (value.type !== 'list' && value.type !== 'tuple')) {
        return { present: true, isStatic: false, names: [] };
      }

      const names: string[] = [];
      let allLiterals = true;
      for (let j = 0; j < value.namedChildCount; j++) {
        const element = value.namedChild(j);
        if (element?.type !== 'string') {
          allLiterals = false;
          continue;
        }
        names.push(this.stringLiteralValue(element));
      }
      return { present: true, isStatic: allLiterals, names };
    }
    return { present: false, isStatic: false, names: [] };
  }

  private stringLiteralValue(stringNode: Parser.SyntaxNode): string {
    for (let i = 0; i < stringNode.namedChildCount; i++) {
      const child = stringNode.namedChild(i);
      if (child?.type === 'string_content') {
        return child.text;
      }
    }
    return '';
  }
}

/** Re-exported so callers can name the module scope without re-deriving it. */
export { PYTHON_MODULE_SCOPE_NAME };
