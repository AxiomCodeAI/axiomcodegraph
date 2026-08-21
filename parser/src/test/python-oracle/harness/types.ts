/** Shapes emitted by oracle/emit_oracle.py, plus the harness's own verdicts. */

export interface OracleProvenance {
  interpreterPath: string;
  sysVersion: string;
  versionInfo: [number, number, number];
  emissionRegime: string;
  symbolPredicates: string[];
  oracleSchemaVersion: string;
}

export interface OracleScope {
  scopeId: string;
  scopeKind: string;
  name: string;
  qualifiedName: string;
  nestingDepth: number;
  parentScopeId: string | null;
  isNested: boolean;
  isOptimized: boolean;
  hasChildren: boolean;
  symtableId: number;
  symtableType: string;
  usesWildcardImport: boolean;
  declaresGlobal: boolean;
  declaresNonlocal: boolean;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  scopeOrdinal: number;
  symtableLineno: number;
}

export interface OracleBinding {
  scopeId: string;
  name: string;
  isSynthetic: boolean;
  [predicate: string]: string | boolean | number;
}

export interface OraclePairing {
  scopeId: string;
  scopeName: string;
  astChildren: { type: string; name: string; line: number; col: number }[];
  symtableChildren: { type: string; name: string; line: number }[];
  /** symtable child -> the ast column it was paired to, in symtable order. */
  pairedColumns: { type: string; name: string; line: number; col: number }[];
  /** Non-empty means the pairing failed; startColumn cannot be trusted. */
  unpaired: string[];
}

export interface OracleError {
  kind: string;
  detail: string;
  [k: string]: unknown;
}

export interface OraclePayload {
  provenance: OracleProvenance;
  module: {
    filePath: string;
    qualifiedName: string;
    emissionRegime: string;
    hasDunderAll: boolean;
    dunderAllIsStatic: boolean;
    dunderAllNames: string[];
  };
  scopes: OracleScope[];
  bindings: OracleBinding[];
  attributeWrites: Record<string, unknown>[];
  structure: {
    classes: Record<string, unknown>[];
    functions: Record<string, unknown>[];
    imports: Record<string, unknown>[];
    calls: Record<string, unknown>[];
  };
  pairing: OraclePairing[];
  errors: OracleError[];
  fatal?: string;
  detail?: unknown;
}

/** A parser-produced fact set: relation name -> rows of column strings. */
export type FactSet = Record<string, string[][]>;

/**
 * Every disagreement is CLASSIFIED, never merely counted. The class determines
 * who adjudicates it and whether it blocks.
 */
export type DisagreementClass =
  | 'MISSING' // oracle has it, parser does not  -> recall failure
  | 'SPURIOUS' // parser has it, oracle does not -> precision failure
  | 'PREDICATE_MISMATCH' // same key, differing symtable predicate
  | 'FIELD_MISMATCH' // same key, differing non-predicate field
  | 'KEY_COLLISION' // two distinct entities produced one key
  | 'ORACLE_INTERNAL'; // the oracle contradicted itself — harness bug until proven otherwise

export interface Disagreement {
  entityKind: string;
  klass: DisagreementClass;
  key: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;
  detail?: string;
}

export interface KindScore {
  entityKind: string;
  expected: number;
  actual: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface InvariantResult {
  id: number;
  name: string;
  passed: boolean;
  checked: number;
  violations: string[];
  skipped?: string;
}

export interface HarnessReport {
  filePath: string;
  provenance: OracleProvenance;
  oracleErrors: OracleError[];
  invariants: InvariantResult[];
  scores: KindScore[];
  disagreements: Disagreement[];
  passed: boolean;
}
