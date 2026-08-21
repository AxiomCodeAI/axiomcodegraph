import * as path from 'path';

import {
  PyBindingRegistry,
  PyImportRegistry,
  PyMethodParameterRegistry,
  PyMethodRegistry,
  PyModuleRegistry,
  PyScopeRegistry,
  PyTypeBaseRegistry,
  PyTypeRegistry,
} from '@/analysis-types/python';
import { PythonDialect } from '@/enums/python/modules';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { PythonDeclarationExtractor } from '@/parsers/python/extractors/python-declaration-extractor';
import {
  PythonExtractionInput,
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

  constructor(
    scopeExtractor?: PythonScopeExtractor,
    declarationExtractor?: PythonDeclarationExtractor
  ) {
    this.scopeExtractor = scopeExtractor ?? new PythonScopeExtractor();
    this.declarationExtractor = declarationExtractor ?? new PythonDeclarationExtractor();
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
    });

    return {
      module: scopeStage.module,
      scopes: scopeStage.scopes,
      bindings: scopeStage.bindings,
      types: declarations.types,
      typeBases: declarations.typeBases,
      methods: declarations.methods,
      methodParameters: declarations.methodParameters,
      imports: declarations.imports,
      dialect: scopeStage.dialect,
      python2Findings: [],
    };
  }
}
