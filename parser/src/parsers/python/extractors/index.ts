export { PythonScopeBuilder } from '@/parsers/python/extractors/python-scope-builder';
export {
  PythonScopeExtractor,
} from '@/parsers/python/extractors/python-scope-extractor';
export type {
  PythonExtractionInput,
  PythonModuleExtraction,
} from '@/parsers/python/extractors/python-scope-extractor';
export {
  analyzeSymbolTable,
  createSymbolBlock,
  DEF_BOUND,
  isOptimized,
  SymbolFlags,
  SymbolScope,
} from '@/parsers/python/extractors/python-symbol-table';
