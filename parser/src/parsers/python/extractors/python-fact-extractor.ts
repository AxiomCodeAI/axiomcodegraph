import * as path from 'path';

import {
  PyBindingRegistry,
  PyBlockRegistry,
  PyCallSiteRegistry,
  PyCommentRegistry,
  PyDecoratorArgumentRegistry,
  PyDecoratorRegistry,
  PyFieldPositionRegistry,
  PyFieldRegistry,
  PyExpressionRegistry,
  PyImportRegistry,
  PyMethodParameterRegistry,
  PyMethodRegistry,
  PyModuleRegistry,
  PyParseGapRegistry,
  PyScopeRegistry,
  PyTypeBaseRegistry,
  PyTypeReferenceRegistry,
  PyTypeRegistry,
} from '@/analysis-types/python';
import { PythonBindingTargetKind } from '@/enums/python/bindings';
import { PythonDialect } from '@/enums/python/modules';
import { PythonScopeOwnerKind } from '@/enums/python/scopes';
import { PythonTypeRefOwnerKind } from '@/enums/python/type-references';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { PythonDeclarationExtractor } from '@/parsers/python/extractors/python-declaration-extractor';
import { PythonExpressionExtractor } from '@/parsers/python/extractors/python-expression-extractor';
import { PythonBlockExtractor } from '@/parsers/python/extractors/python-block-extractor';
import { PythonCommentExtractor } from '@/parsers/python/extractors/python-comment-extractor';
import { PythonParseGapExtractor } from '@/parsers/python/extractors/python-parse-gap-extractor';
import { PythonDecoratorExtractor } from '@/parsers/python/extractors/python-decorator-extractor';
import { PythonFieldExtractor } from '@/parsers/python/extractors/python-field-extractor';
import { PythonResolutionLinker } from '@/parsers/python/extractors/python-resolution-linker';
import { PythonTypeReferenceExtractor } from '@/parsers/python/extractors/python-type-reference-extractor';
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
  /**
   * Class and instance attributes.
   *
   * Un-deferred because it is not optional for a call graph: `self.x.m()` is
   * unresolvable without the type of `x`, and this is the only relation that
   * carries it. It was 0/2,537 resolved before this existed.
   */
  fields: PyFieldRegistry[];
  /** Class-body declaration order — a generated `__init__` honours it. */
  fieldPositions: PyFieldPositionRegistry[];
  /**
   * Decorator applications, and their arguments.
   *
   * A decorator is a call that runs at definition time and rebinds the decorated
   * name, so `applicationOrder` (bottom-up, the order that runs) and
   * `replacesTarget` are what a consumer actually needs — not just the name.
   */
  decorators: PyDecoratorRegistry[];
  decoratorArguments: PyDecoratorArgumentRegistry[];
  /**
   * Control-flow blocks. Containment is by SPAN, as in Java; the one FK runs the
   * other way, from a block to its condition expression, because that is what
   * `isinstance` narrowing needs.
   */
  blocks: PyBlockRegistry[];
  /**
   * Regions the grammar could not represent.
   *
   * The one relation whose ABSENCE is invisible: a region the parser gave up on
   * produces silence, and silence looks identical to "there was nothing there".
   * Zero rows is the expected state for ~99.6% of modules.
   */
  parseGaps: PyParseGapRegistry[];
  /**
   * Comments and docstrings. Most are DIRECTIVES rather than prose — an encoding
   * cookie, a `# type:` annotation, a `# noqa` — and a docstring appears here as
   * well as in `py_expression`, which §2.17 makes intentional.
   */
  comments: PyCommentRegistry[];
  /**
   * `(pyTypeLinkHash, attributeName)` -> `py_field` PK, and `py_method` PK ->
   * receiver name. Both are indexes the cross-module pass needs to redo the
   * attribute join it cannot recompute from CSV rows alone.
   */
  fieldHashByTypeAndName: Map<string, string>;
  receiverNameByMethodHash: Map<string, string>;
  /** Assignment target byte range -> value byte range; the exact pairing. */
  assignedValueByTargetRange: Map<string, string>;
  expressionByByteRange: Map<string, string>;
  /**
   * Type references — the nested tree that links `Dict[TypeA, TypeB]` to all
   * three types with parent/position/depth.
   */
  typeReferences: PyTypeReferenceRegistry[];

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
  private typeReferenceExtractor: PythonTypeReferenceExtractor;
  private fieldExtractor: PythonFieldExtractor;
  private decoratorExtractor: PythonDecoratorExtractor;
  private blockExtractor: PythonBlockExtractor;
  private parseGapExtractor: PythonParseGapExtractor;
  private commentExtractor: PythonCommentExtractor;
  /** The parameter rows of the file being processed, for default-value linking. */
  private lastParameters: PyMethodParameterRegistry[] = [];

  constructor(
    scopeExtractor?: PythonScopeExtractor,
    declarationExtractor?: PythonDeclarationExtractor,
    expressionExtractor?: PythonExpressionExtractor,
    resolutionLinker?: PythonResolutionLinker,
    typeReferenceExtractor?: PythonTypeReferenceExtractor
  ) {
    this.scopeExtractor = scopeExtractor ?? new PythonScopeExtractor();
    this.declarationExtractor = declarationExtractor ?? new PythonDeclarationExtractor();
    this.expressionExtractor = expressionExtractor ?? new PythonExpressionExtractor();
    this.resolutionLinker = resolutionLinker ?? new PythonResolutionLinker();
    this.typeReferenceExtractor =
      typeReferenceExtractor ?? new PythonTypeReferenceExtractor();
    this.fieldExtractor = new PythonFieldExtractor();
    this.decoratorExtractor = new PythonDecoratorExtractor();
    this.blockExtractor = new PythonBlockExtractor();
    this.parseGapExtractor = new PythonParseGapExtractor();
    this.commentExtractor = new PythonCommentExtractor();
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
        fields: [],
        fieldPositions: [],
        decorators: [],
        decoratorArguments: [],
        blocks: [],
        comments: [],
        // A REJECTED module still gets its gaps. This is the case the relation
        // exists for: nothing else is emitted, so without these rows the file is
        // indistinguishable from one that simply had no facts in it.
        parseGaps:
          scopeStage.module && scopeStage.rootNode
            ? this.parseGapExtractor.extract({
                module: scopeStage.module,
                rootNode: scopeStage.rootNode,
                serviceVersionLinkHash: input.serviceVersionLinkHash,
                positions: scopeStage.positions,
                python2Findings: scopeStage.python2Findings,
              })
            : [],
        fieldHashByTypeAndName: new Map<string, string>(),
        receiverNameByMethodHash: new Map<string, string>(),
        assignedValueByTargetRange: new Map<string, string>(),
        expressionByByteRange: new Map<string, string>(),
        typeReferences: [],
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

    const fieldStage = this.fieldExtractor.extract({
      module: scopeStage.module,
      rootNode: scopeStage.rootNode,
      filePath: input.filePath,
      serviceVersionLinkHash: input.serviceVersionLinkHash,
      types: declarations.types,
      methods: declarations.methods,
      typeHashByNodeId: declarations.typeHashByNodeId,
      methodHashByNodeId: declarations.methodHashByNodeId,
      scopeHashByNodeId: scopeStage.scopeHashByNodeId,
      bindingHashByScopeAndName: scopeStage.bindingHashByScopeAndName,
      positions: scopeStage.positions,
    });

    const decoratorStage = this.decoratorExtractor.extract({
      module: scopeStage.module,
      rootNode: scopeStage.rootNode,
      serviceVersionLinkHash: input.serviceVersionLinkHash,
      typeHashByNodeId: declarations.typeHashByNodeId,
      methodHashByNodeId: declarations.methodHashByNodeId,
    });

    const blockStage = this.blockExtractor.extract({
      module: scopeStage.module,
      rootNode: scopeStage.rootNode,
      filePath: input.filePath,
      serviceVersionLinkHash: input.serviceVersionLinkHash,
      types: declarations.types,
      methods: declarations.methods,
      typeHashByNodeId: declarations.typeHashByNodeId,
      methodHashByNodeId: declarations.methodHashByNodeId,
      classInitHashByNodeId: declarations.classInitHashByNodeId,
      scopeHashByNodeId: scopeStage.scopeHashByNodeId,
      moduleMethodHash: declarations.moduleMethodHash,
      positions: scopeStage.positions,
    });

    // ---- back-patching --------------------------------------------------
    // Three FKs cannot be set when their row is minted, because the entity they
    // point at does not exist yet. Accumulate-then-export makes patching free:
    // nothing has been written, and none of these columns is part of a primary
    // key, so no hash changes.
    // Intra-module resolution runs last, once every entity it can point at
    // exists. Cross-module resolution is the project pass's job: it needs the
    // module graph, which a single-file extraction does not have.
    const typeReferences = this.typeReferenceExtractor.extract({
      positions: declarations.typePositions,
      pyModuleLinkHash: scopeStage.module.getHash(),
      serviceVersionLinkHash: input.serviceVersionLinkHash,
    });

    this.linkTypeBasesToTheirReferences(declarations.typeBases, typeReferences);
    // Before resolution, not after: resolving a decorator needs its expression's
    // SCOPE, and the scope is only reachable through this FK. Linking afterwards
    // left every decorator unresolved while looking correct in isolation.
    this.linkDecoratorsToTheirExpressions(decoratorStage, expressionStage);
    // Joined on BYTE RANGE, like every other cross-stage link here: the block
    // stage and the expression stage mint rows independently.
    for (const block of blockStage.blocks) {
      const range = blockStage.conditionRangeByBlock.get(block.getHash());
      const expressionHash = range
        ? expressionStage.expressionByByteRange.get(range)
        : undefined;
      if (expressionHash) {
        block.setConditionExpressionLinkHash(expressionHash);
      }
    }

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
      typeReferences,
      fields: fieldStage.fields,
      decorators: decoratorStage.decorators,
      decoratorArguments: decoratorStage.decoratorArguments,
      blocks: blockStage.blocks,
      fieldHashByTypeAndName: fieldStage.fieldHashByTypeAndName,
      receiverNameByMethodHash: fieldStage.receiverNameByMethodHash,
      assignedValueByTargetRange: expressionStage.assignedValueByTargetRange,
      expressionByByteRange: expressionStage.expressionByByteRange,
      byteRangeByExpression: new Map(
        [...expressionStage.expressionByByteRange].map(([range, hash]) => [hash, range])
      ),
    });

    this.linkBindingTargets(scopeStage, declarations, fieldStage);
    this.linkFieldsToTheirWriteExpressions(fieldStage, expressionStage);
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
      fields: fieldStage.fields,
      fieldPositions: fieldStage.fieldPositions,
      decorators: decoratorStage.decorators,
      decoratorArguments: decoratorStage.decoratorArguments,
      blocks: blockStage.blocks,
      comments: this.commentExtractor.extract({
        module: scopeStage.module,
        rootNode: scopeStage.rootNode,
        filePath: input.filePath,
        serviceVersionLinkHash: input.serviceVersionLinkHash,
        types: declarations.types,
        methods: declarations.methods,
        typeHashByNodeId: declarations.typeHashByNodeId,
        methodHashByNodeId: declarations.methodHashByNodeId,
        moduleMethodHash: declarations.moduleMethodHash,
        positions: scopeStage.positions,
      }),
      parseGaps: this.parseGapExtractor.extract({
        module: scopeStage.module,
        rootNode: scopeStage.rootNode,
        serviceVersionLinkHash: input.serviceVersionLinkHash,
        positions: scopeStage.positions,
        python2Findings: scopeStage.python2Findings,
      }),
      fieldHashByTypeAndName: fieldStage.fieldHashByTypeAndName,
      receiverNameByMethodHash: fieldStage.receiverNameByMethodHash,
      assignedValueByTargetRange: expressionStage.assignedValueByTargetRange,
      expressionByByteRange: expressionStage.expressionByByteRange,
      typeReferences,
      dialect: scopeStage.dialect,
      python2Findings: [],
    };
  }

  /**
   * Links each `py_type_base` row to its twin `py_type_reference`.
   *
   * The two rows are created by different stages, so the FK can only be set
   * afterwards. Both directions matter: the type-reference row already carries
   * `typeReferenceOwnerHash` pointing AT the base, but §2.5 c9 is the reverse
   * link, and `type-hierarchy.dl` traverses base → type_reference — so a rule
   * ported from Java finds nothing without it.
   *
   * Only the DEPTH-0 reference is the twin. A nested argument such as the `T` in
   * `class Box(Generic[T])` is owned by the same base row but is not the base's
   * own reference.
   */
  private linkTypeBasesToTheirReferences(
    typeBases: PyTypeBaseRegistry[],
    typeReferences: PyTypeReferenceRegistry[]
  ): void {
    const rootByOwner = new Map<string, PyTypeReferenceRegistry>();
    for (const reference of typeReferences) {
      if (reference.getDepth() !== 0) {
        continue;
      }
      if (reference.getReferenceOwnerKind() !== PythonTypeRefOwnerKind.TYPE_BASE) {
        continue;
      }
      rootByOwner.set(reference.getTypeReferenceOwnerHash(), reference);
    }
    for (const base of typeBases) {
      const twin = rootByOwner.get(base.getHash());
      if (twin) {
        base.setPyTypeReferenceLinkHash(twin.getHash());
      }
    }
  }

  /**
   * Sets `py_field.pyExpressionLinkHash` — the first write's target node.
   *
   * Joined on the target's BYTE RANGE, since the field stage and the expression
   * stage mint their rows independently. A byte range identifies a node
   * uniquely where a start offset does not.
   */
  private linkFieldsToTheirWriteExpressions(
    fieldStage: { fields: PyFieldRegistry[]; targetByteRangeByField: Map<string, string> },
    expressionStage: { expressionByByteRange: Map<string, string> }
  ): void {
    for (const field of fieldStage.fields) {
      const range = fieldStage.targetByteRangeByField.get(field.getHash());
      if (!range) {
        continue;
      }
      const expressionHash = expressionStage.expressionByByteRange.get(range);
      if (expressionHash) {
        field.setPyExpressionLinkHash(expressionHash);
      }
    }
  }

  /**
   * Sets `py_decorator.pyExpressionLinkHash` and the same on its arguments.
   *
   * Joined on BYTE RANGE, since the decorator stage and the expression stage
   * mint their rows independently. Without it a consumer can read a decorator's
   * text but cannot reach the expression tree underneath it — so
   * `@app.route(PREFIX + "/admin")` would be an opaque string rather than a
   * concatenation whose operands are already linked to their bindings.
   */
  private linkDecoratorsToTheirExpressions(
    decoratorStage: {
      decorators: PyDecoratorRegistry[];
      decoratorArguments: PyDecoratorArgumentRegistry[];
      expressionRangeByDecorator: Map<string, string>;
      expressionRangeByArgument: Map<string, string>;
    },
    expressionStage: { expressionByByteRange: Map<string, string> }
  ): void {
    for (const decorator of decoratorStage.decorators) {
      const range = decoratorStage.expressionRangeByDecorator.get(decorator.getHash());
      const expressionHash = range ? expressionStage.expressionByByteRange.get(range) : undefined;
      if (expressionHash) {
        decorator.setPyExpressionLinkHash(expressionHash);
      }
    }
    for (const argument of decoratorStage.decoratorArguments) {
      const range = decoratorStage.expressionRangeByArgument.get(argument.getHash());
      const expressionHash = range ? expressionStage.expressionByByteRange.get(range) : undefined;
      if (expressionHash) {
        argument.setPyExpressionLinkHash(expressionHash);
      }
    }
  }

  /**
   * Sets `py_binding.targetEntityHash` — the entity a binding actually declares.
   *
   * `targetEntityKind` was being written on every row while `targetEntityHash`
   * stayed empty, which is the same failure as the type_base twin FK and just as
   * invisible: a discriminator saying `METHOD` with nothing to dereference reads
   * as healthy to an orphan check, because an empty FK is skipped. A consumer
   * asking "which def does this name bind?" had to fall back to matching names,
   * which is exactly what the hash exists to avoid — two `def handler` in one
   * module are different entities with the same name.
   *
   * The link is built from the REVERSE direction, which already existed:
   * declarations record `declaringBindingLinkHash`, so this inverts that rather
   * than re-deriving the association and risking a different answer.
   */
  private linkBindingTargets(
    scopeStage: PythonModuleExtraction,
    declarations: PythonDeclarationExtraction,
    fieldStage: { fields: PyFieldRegistry[] }
  ): void {
    const targetByBinding = new Map<string, { kind: PythonBindingTargetKind; hash: string }>();
    for (const type of declarations.types) {
      const binding = type.getDeclaringBindingLinkHash();
      if (binding !== '') {
        targetByBinding.set(binding, { kind: PythonBindingTargetKind.TYPE, hash: type.getHash() });
      }
    }
    for (const method of declarations.methods) {
      const binding = method.getDeclaringBindingLinkHash();
      if (binding !== '') {
        targetByBinding.set(binding, {
          kind: PythonBindingTargetKind.METHOD,
          hash: method.getHash(),
        });
      }
    }
    for (const record of declarations.imports) {
      const binding = record.getBindingLinkHash();
      if (binding !== '') {
        targetByBinding.set(binding, {
          kind: PythonBindingTargetKind.IMPORT,
          hash: record.getHash(),
        });
      }
    }
    // A parameter binds too, and its entity is the parameter row rather than the
    // method — `local-flow.dl` needs the parameter to attribute an argument.
    for (const parameter of declarations.methodParameters) {
      const binding = parameter.getBindingLinkHash();
      if (binding !== '' && !targetByBinding.has(binding)) {
        targetByBinding.set(binding, {
          kind: PythonBindingTargetKind.PARAMETER,
          hash: parameter.getHash(),
        });
      }
    }
    void fieldStage;

    for (const binding of scopeStage.bindings) {
      const target = targetByBinding.get(binding.getHash());
      if (target) {
        binding.setTargetEntity(target.kind, target.hash);
      }
    }

    // A FREE variable closes over a binding in an ENCLOSING scope, and until now
    // it resolved to nothing — `targetEntityKind=NONE`, empty hash. That broke
    // the one chain a decorator exists to make traceable:
    //
    //   @audit on Impl.run  ->  audit  ->  returns wrapper  ->  wrapper calls fn
    //
    // `fn` inside `wrapper` IS `audit`'s parameter, and without this link the
    // trace dead-ends exactly where it becomes interesting. CPython's symtable
    // states the relationship outright — a free variable resolves to a cell in
    // an enclosing scope — so this is reading a fact rather than inferring one.
    const parentScopeOf = new Map<string, string>();
    for (const scope of scopeStage.scopes) {
      parentScopeOf.set(scope.getHash(), scope.getParentScopeLinkHash());
    }
    const bindingByScopeAndName = new Map<string, PyBindingRegistry>();
    for (const binding of scopeStage.bindings) {
      bindingByScopeAndName.set(
        `${binding.getPyScopeLinkHash()}::${binding.getName()}`,
        binding
      );
    }
    for (const binding of scopeStage.bindings) {
      if (!binding.isFreeVariable() || binding.getTargetEntityHash() !== '') {
        continue;
      }
      let scope: string | undefined = parentScopeOf.get(binding.getPyScopeLinkHash());
      let guard = 0;
      while (scope !== undefined && scope !== '' && guard < 200) {
        guard += 1;
        const enclosing = bindingByScopeAndName.get(`${scope}::${binding.getName()}`);
        // Only a binding that actually BINDS terminates the walk; a scope that
        // merely mentions the name is not where the cell lives.
        if (enclosing?.isBound() && enclosing.getTargetEntityHash() !== '') {
          binding.setTargetEntity(
            enclosing.getTargetEntityKind(),
            enclosing.getTargetEntityHash()
          );
          break;
        }
        scope = parentScopeOf.get(scope);
      }
    }
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
