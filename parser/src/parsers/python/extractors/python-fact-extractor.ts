import * as path from 'path';

import {
  PyBindingRegistry,
  PyCallSiteRegistry,
  PyExpressionRegistry,
  PyImportRegistry,
  PyMethodParameterRegistry,
  PyMethodRegistry,
  PyModuleRegistry,
  PyScopeRegistry,
  PyTypeBaseRegistry,
  PyTypeRegistry,
} from '@/analysis-types/python';
import { PythonBindingTargetKind } from '@/enums/python/bindings';
import { PythonDialect } from '@/enums/python/modules';
import { PythonScopeOwnerKind } from '@/enums/python/scopes';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { PythonDeclarationExtractor } from '@/parsers/python/extractors/python-declaration-extractor';
import { PythonExpressionExtractor } from '@/parsers/python/extractors/python-expression-extractor';
import { PythonResolutionLinker } from '@/parsers/python/extractors/python-resolution-linker';
import {
  PythonExtractionInput,
  PythonModuleExtraction,
  PythonScopeExtractor,
} from '@/parsers/python/extractors/python-scope-extractor';
import { Python2Finding } from '@/types/python';

/** Every spine relation the parser emits for one file. */
export interface PythonFactSet {
  /** `undefined` when the file was rejected. */
  module?: PyModuleRegistry;
  scopes: PyScopeRegistry[];
  bindings: PyBindingRegistry[];
  types: PyTypeRegistry[];
  typeBases: PyTypeBaseRegistry[];
  methods: PyMethodRegistry[];
  methodParameters: PyMethodParameterRegistry[];
  imports: PyImportRegistry[];
  expressions: PyExpressionRegistry[];
  callSites: PyCallSiteRegistry[];

  dialect: PythonDialect;
  /** Present only for a rejected file. */
  skippedReason?: SkippedFileReason;
  /** Python 2 constructs found, for `py_parse_gap` and the skipped-files CSV. */
  python2Findings: Python2Finding[];
}

/**
 * Runs both spine stages over one Python file and returns every relation.
 *
 * This is the entry point a caller should use. It exists so the two stages
 * share **one parse and one symbol table**: the declaration stage needs the
 * scope PKs and binding PKs that the scope stage mints, and re-parsing to get
 * them would both cost double on files over the 32,767-character limit and risk
 * the two stages disagreeing about the tree they are describing.
 *
 * ## Rejection is total
 *
 * If the file is Python 2, **nothing** is emitted — no module row, no scopes, no
 * declarations — and `skippedReason` is set instead. A Python 2 file parses
 * cleanly, so there is no error for a downstream stage to notice; emitting a
 * partial fact set would be a confident wrong answer.
 */
export class PythonFactExtractor {
  private scopeExtractor: PythonScopeExtractor;
  private declarationExtractor: PythonDeclarationExtractor;
  private expressionExtractor: PythonExpressionExtractor;
  private resolutionLinker: PythonResolutionLinker;
  /** The parameter rows of the file being processed, for default-value linking. */
  private lastParameters: PyMethodParameterRegistry[] = [];

  constructor(
    scopeExtractor?: PythonScopeExtractor,
    declarationExtractor?: PythonDeclarationExtractor,
    expressionExtractor?: PythonExpressionExtractor,
    resolutionLinker?: PythonResolutionLinker
  ) {
    this.scopeExtractor = scopeExtractor ?? new PythonScopeExtractor();
    this.declarationExtractor = declarationExtractor ?? new PythonDeclarationExtractor();
    this.expressionExtractor = expressionExtractor ?? new PythonExpressionExtractor();
    this.resolutionLinker = resolutionLinker ?? new PythonResolutionLinker();
  }

  extract(input: PythonExtractionInput): PythonFactSet {
    const scopeStage = this.scopeExtractor.extract(input);

    if (scopeStage.dialect !== PythonDialect.PY3 || !scopeStage.module || !scopeStage.rootNode) {
      return {
        scopes: [],
        bindings: [],
        types: [],
        typeBases: [],
        methods: [],
        methodParameters: [],
        imports: [],
        expressions: [],
        callSites: [],
        dialect: scopeStage.dialect,
        skippedReason: SkippedFileReason.PY2_CONSTRUCT_DETECTED,
        python2Findings: scopeStage.python2Findings,
      };
    }

    const declarations = this.declarationExtractor.extract({
      module: scopeStage.module,
      rootNode: scopeStage.rootNode,
      filePath: input.filePath,
      baseMservPath: input.baseMservPath,
      fileName: path.basename(input.filePath),
      serviceVersionLinkHash: input.serviceVersionLinkHash,
      scopeHashByNodeId: scopeStage.scopeHashByNodeId,
      bindingHashByScopeAndName: scopeStage.bindingHashByScopeAndName,
      qualifiedNameByNodeId: scopeStage.qualifiedNameByNodeId,
      positions: scopeStage.positions,
    });

    this.lastParameters = declarations.methodParameters;

    const expressionStage = this.expressionExtractor.extract({
      module: scopeStage.module,
      rootNode: scopeStage.rootNode,
      serviceVersionLinkHash: input.serviceVersionLinkHash,
      scopeHashByNodeId: scopeStage.scopeHashByNodeId,
      bindingHashByScopeAndName: scopeStage.bindingHashByScopeAndName,
      methodHashByNodeId: declarations.methodHashByNodeId,
      typeHashByNodeId: declarations.typeHashByNodeId,
      moduleMethodHash: declarations.moduleMethodHash,
      classInitHashByNodeId: declarations.classInitHashByNodeId,
      positions: scopeStage.positions,
      lambdaMethodByNodeId: declarations.lambdaMethodByNodeId,
      parameterHashByAnnotationRange: declarations.parameterHashByAnnotationRange,
    });

    // ---- back-patching --------------------------------------------------
    // Three FKs cannot be set when their row is minted, because the entity they
    // point at does not exist yet. Accumulate-then-export makes patching free:
    // nothing has been written, and none of these columns is part of a primary
    // key, so no hash changes.
    // Intra-module resolution runs last, once every entity it can point at
    // exists. Cross-module resolution is the project pass's job: it needs the
    // module graph, which a single-file extraction does not have.
    this.resolutionLinker.link({
      scopes: scopeStage.scopes,
      bindings: scopeStage.bindings,
      types: declarations.types,
      typeBases: declarations.typeBases,
      methods: declarations.methods,
      methodParameters: declarations.methodParameters,
      imports: declarations.imports,
      callSites: expressionStage.callSites,
      expressions: expressionStage.expressions,
    });

    this.linkScopeOwners(scopeStage, declarations);
    this.linkBindingMethods(scopeStage, declarations);
    this.linkParameterDefaults(declarations, expressionStage);

    return {
      module: scopeStage.module,
      scopes: scopeStage.scopes,
      bindings: scopeStage.bindings,
      types: declarations.types,
      typeBases: declarations.typeBases,
      methods: declarations.methods,
      methodParameters: declarations.methodParameters,
      imports: declarations.imports,
      expressions: expressionStage.expressions,
      callSites: expressionStage.callSites,
      dialect: scopeStage.dialect,
      python2Findings: [],
    };
  }

  /**
   * Sets `py_scope.ownerHash`, the polymorphic owner FK.
   *
   * Without this the discriminator lies: `ownerKind` would say `TYPE` while
   * `ownerHash` was empty, so invariant #1 could not resolve the FK in the
   * relation the discriminator names.
   */
  private linkScopeOwners(
    scopeStage: PythonModuleExtraction,
    declarations: {
      scopeOwnerByNodeId: Map<number, string>;
      enclosingMethodByScopeNodeId: Map<number, string>;
    }
  ): void {
    const ownerByScopeHash = new Map<string, string>();
    for (const [nodeId, ownerHash] of declarations.scopeOwnerByNodeId) {
      const scopeHash = scopeStage.scopeHashByNodeId.get(nodeId);
      if (scopeHash) {
        ownerByScopeHash.set(scopeHash, ownerHash);
      }
    }
    for (const scope of scopeStage.scopes) {
      const ownerHash = ownerByScopeHash.get(scope.getHash());
      if (ownerHash) {
        scope.setOwner(scope.getOwnerKind(), ownerHash);
        continue;
      }
      // A comprehension scope has no declaration of its own, so it inherits the
      // nearest enclosing METHOD. Resolving against the owner map instead would
      // hand a module-level comprehension the py_module hash while its
      // discriminator says COMPREHENSION — present, non-dangling, and pointing
      // into the wrong relation. A LAMBDA scope does not come here at all: it has
      // its own py_method, registered above.
      if (scope.getOwnerKind() === PythonScopeOwnerKind.COMPREHENSION) {
        const enclosing = this.enclosingMethodFor(scope, scopeStage, declarations);
        if (enclosing) {
          scope.setOwner(scope.getOwnerKind(), enclosing);
        }
      }
    }
  }

  /**
   * Sets `py_binding.pyMethodLinkHash` — the enclosing function.
   *
   * This is the `java_local_variable` column-13 analogue, which is what lets
   * `local-flow.dl` port to Python by relation rename alone. Leaving it empty
   * would silently break that port.
   */
  private linkBindingMethods(
    scopeStage: PythonModuleExtraction,
    declarations: { enclosingMethodByScopeNodeId: Map<number, string> }
  ): void {
    const methodByScopeHash = new Map<string, string>();
    for (const [nodeId, methodHash] of declarations.enclosingMethodByScopeNodeId) {
      const scopeHash = scopeStage.scopeHashByNodeId.get(nodeId);
      if (scopeHash) {
        methodByScopeHash.set(scopeHash, methodHash);
      }
    }
    // A comprehension or lambda scope has no method row of its own, so its
    // bindings belong to the nearest enclosing scope that does.
    const parentByScopeHash = new Map<string, string>();
    for (const scope of scopeStage.scopes) {
      parentByScopeHash.set(scope.getHash(), scope.getParentScopeLinkHash());
    }
    for (const binding of scopeStage.bindings) {
      let scopeHash: string | undefined = binding.getPyScopeLinkHash();
      let methodHash = methodByScopeHash.get(scopeHash);
      while (!methodHash && scopeHash) {
        scopeHash = parentByScopeHash.get(scopeHash);
        methodHash = scopeHash ? methodByScopeHash.get(scopeHash) : undefined;
      }
      if (methodHash) {
        binding.setPyMethodLinkHash(methodHash);
      }
    }
  }

  /**
   * Sets `py_method_parameter.pyExpressionLinkHash` — the default-value root.
   *
   * The two stages mint their rows independently, so they are joined on the
   * default expression's BYTE RANGE. A byte range identifies a node uniquely,
   * where a start offset alone does not.
   */
  private linkParameterDefaults(
    declarations: { parameterDefaultByteRange: Map<string, string> },
    expressionStage: { expressionByByteRange: Map<string, string> }
  ): void {
    if (declarations.parameterDefaultByteRange.size === 0) {
      return;
    }
    for (const parameter of this.lastParameters) {
      const range = declarations.parameterDefaultByteRange.get(parameter.getHash());
      if (!range) {
        continue;
      }
      const expressionHash = expressionStage.expressionByByteRange.get(range);
      if (expressionHash) {
        parameter.setPyExpressionLinkHash(expressionHash);
      }
    }
  }

  /**
   * Walks up the scope chain to the nearest enclosing `py_method`.
   *
   * Keyed on the enclosing-METHOD map rather than the owner map, because the
   * owner of a module scope is the module itself. A comprehension needs a
   * method, and the synthetic `<module>` / `<classbody>` initializers exist so
   * that one always exists.
   */
  private enclosingMethodFor(
    scope: { getParentScopeLinkHash(): string },
    scopeStage: PythonModuleExtraction,
    declarations: { enclosingMethodByScopeNodeId: Map<number, string> }
  ): string | undefined {
    const ownerByScopeHash = new Map<string, string>();
    for (const [nodeId, ownerHash] of declarations.enclosingMethodByScopeNodeId) {
      const scopeHash = scopeStage.scopeHashByNodeId.get(nodeId);
      if (scopeHash) {
        ownerByScopeHash.set(scopeHash, ownerHash);
      }
    }
    const parentByScopeHash = new Map<string, string>();
    for (const s of scopeStage.scopes) {
      parentByScopeHash.set(s.getHash(), s.getParentScopeLinkHash());
    }
    let current: string | undefined = scope.getParentScopeLinkHash();
    while (current) {
      const owner = ownerByScopeHash.get(current);
      if (owner) {
        return owner;
      }
      current = parentByScopeHash.get(current);
    }
    return undefined;
  }
}
