/**
 * PER-LANGUAGE ADAPTERS — the only place the front ends differ, written as data.
 *
 * Each adapter says (1) which raw Soufflé relation feeds each core table and how its
 * positional columns map, and (2) which parser IR file, and which HEADER NAMES in it, carry
 * each core column of methods / types / call_sites. Names, not indexes: the reader resolves
 * them against the file's own header and refuses on a name that is missing, so a parser
 * schema change surfaces as an error naming the column rather than as a silent misjoin.
 *
 * Nothing here interprets a value. Vocabulary and caveats live in schema.ts.
 */
import type { Language } from '@/bundle/schema';

/** How one raw relation's columns land in a core table. Column indexes are 0-based. */
export interface RawSource {
  /** basename in raw/, e.g. `resolution-type-ancestor.csv` */
  file: string;
  /** which raw column feeds each core column, in core column order */
  columns: number[];
  /** a constant appended after the mapped columns (e.g. `how = new` where the raw has no such column) */
  constant?: string;
}

/** Header names of one IR entity file that carry the core columns. */
export interface MethodsIR {
  file: string; id: string; name: string; qualifiedName: string; kind: string;
  ownerTypeId: string; startLine: string; endLine: string;
  /**
   * absent where the entity row carries no path of its own, in which case the file is
   * resolved through `moduleId` against the modules table. C# is that shape: a
   * cs_method row names its module and its type and neither carries a path, and the
   * type is legitimately blank for a top-level-statements entry point and for a local
   * function -- so the type cannot be the route either.
   */
  filePath?: string;
  /** absent where the IR has no such column (JavaScript declares no signatures); the core column is then '' / NULL */
  signature?: string; ownerQualifiedName?: string;
  /**
   * Where the IR carries no owner-qualified-name column but the owner is a real type row
   * (C#), true takes the column from the owning type's qualified_name once types are read.
   * JavaScript leaves it unset: see its NOTES entry in schema.ts.
   */
  ownerQualifiedNameFromType?: boolean;
  /** declared visibility (Java: methodAccess). Absent where the language has no access modifiers. */
  access?: string;
  /** the column naming the owning module, where a LIBRARY row's names are relative to its own package root and need the package prefixed (see ModulesIR.packageName) */
  moduleId?: string;
}
export interface TypesIR {
  file: string; id: string; name: string; qualifiedName: string; category: string;
  startLine: string; endLine: string;
  /** absent where the row carries no path; resolved through `moduleId` (see MethodsIR). */
  filePath?: string;
  moduleId?: string;
  /** declared visibility (Java: typeAccess). Absent where the language has no access modifiers. */
  access?: string;
}
/**
 * A modules table, where the language has one: maps a module hash to a file path. Where the
 * parser names a library module's package (`packageName`) and its root on disk (`basePath`),
 * the bundle prefixes every library row's qualified_name and file_path with the package, so
 * a same-named file in two packages, or two staged versions of one package, stay apart.
 */
export interface ModulesIR { file: string; id: string; filePath: string; packageName?: string; basePath?: string }
/**
 * The field tables, where the language has them. Two files, because a Java enum constant is a
 * field the parser gives its own table and its own hash prefix; both land in one `fields` core
 * table with a `kind` column, since `Colour.RED` is resolved and read exactly as a static field
 * is. A language with no such relation omits this and its `fields` / `field_access` tables stay
 * empty rather than absent (see schema.ts NOTES).
 */
export interface FieldsIR {
  file: string; id: string; name: string; ownerTypeId: string;
  ownerQualifiedName?: string; typeName?: string; modifiers?: string;
  /** as MethodsIR.ownerQualifiedNameFromType */
  ownerQualifiedNameFromType?: boolean;
  startLine: string; endLine: string;
  /** absent where the row carries no path; resolved through `moduleId` (see MethodsIR). */
  filePath?: string;
  moduleId?: string;
  /** a second file holding enum constants, with the same column roles */
  enumConstants?: { file: string; id: string; name: string; ownerTypeId: string; ownerQualifiedName?: string; filePath?: string; moduleId?: string; startLine: string; endLine: string };
}
/** The expressions table — the universal fallback for a site's position. */
export interface ExpressionsIR {
  file: string; id: string; kind: string; startLine: string; startColumn: string; endLine: string; endColumn: string;
  /** header name of the column that locates the file: a module hash (TS/Python) or the owning type hash (Java) */
  fileVia: { column: string; through: 'modules' | 'types' };
  /** Java only: the written callee name sits in this column for these expression kinds */
  calleeName?: { column: string; kinds: readonly string[] };
}
/** The call-sites table (TS/Python): keyed by its EXPRESSION link, since that is what the edge carries. */
export interface CallSitesIR {
  file: string; expressionId: string; calleeName: string; startLine: string; startColumn: string; endLine?: string;
  fileVia: { column: string; through: 'modules' };
}
/**
 * Python decorators — a site id may be the decorator's own hash (a bare decorator with no
 * expression row) or the decorator's EXPRESSION hash; the row links both, so it is matched
 * on either to name and position the site.
 */
export interface DecoratorsIR {
  file: string; id: string; expressionId: string; name: string; startLine: string; endLine: string;
  fileVia: { column: string; through: 'modules' };
}

/**
 * The parser's skipped-files report — the one IR file that names what is NOT in any other
 * table. Its columns differ per front end (only Python records a construct and a position),
 * so every column but the path and the reason is optional and reads as NULL where absent.
 */
export interface SkippedIR {
  file: string; filePath: string; reason: string;
  /** the syntactic form that caused the rejection (Python only) */
  construct?: string;
  startLine?: string; startColumn?: string;
  /** free text: the error message, or the file count behind a DIRECTORY_EXCLUDED row */
  detail?: string;
}

export interface LanguageAdapter {
  language: Language;
  /** id prefixes, for the sanity report only */
  prefixes: { method: string; type: string; expression: string; module?: string; decorator?: string };
  raw: {
    callEdges: RawSource;
    typeAncestors?: RawSource;
    overrides?: RawSource;
    dispatchCandidates?: RawSource;
    entryPoints?: RawSource;
    entryReachable?: RawSource;
    typeInstantiated?: RawSource;
    /** (site, caller, field, fieldProv, tier, access) — #663; absent means the table stays empty */
    fieldAccess?: RawSource;
    /** (ref, owner, ownerKind, enclType, enclMethod, type, prov, context, depth, tier) — #663 */
    typeUse?: RawSource;
    /**
     * (key, mechanism, siteKind, site, prov) — #890. A config key binds to a FIELD, and
     * that is a reason to list the field, exactly as a field_access edge is. Without it
     * a library field bound by @Value but read by nothing was referenced by an exported
     * relation and absent from `fields`, so the join lost the row silently.
     */
    configBinding?: RawSource;
  };
  ir: {
    methods: MethodsIR;
    types: TypesIR;
    fields?: FieldsIR;
    modules?: ModulesIR;
    expressions: ExpressionsIR;
    callSites?: CallSitesIR;
    decorators?: DecoratorsIR;
    /** absent where the front end writes no skipped-files report */
    skipped?: SkippedIR;
  };
}

// The merged edge is the one relation every front end exports in the same shape:
//   0 FromExpr  1 FromMethod  2 ToExpr("-")  3 ToMethod  4 Prov  5 EdgeStatus  6 Kind
const CALL_EDGES: RawSource = { file: 'call-chain-edges.csv', columns: [0, 1, 3, 4, 5, 6] };

const JAVA: LanguageAdapter = {
  language: 'java',
  prefixes: { method: 'METHOD_REGISTRY_', type: 'TYPE_REGISTRY_', expression: 'EXPRESSION_REFERENCE_' },
  raw: {
    callEdges: CALL_EDGES,
    typeAncestors: { file: 'resolution-type-ancestor.csv', columns: [0, 1] },
    overrides: { file: 'resolution-virtual-override.csv', columns: [0, 1] },
    dispatchCandidates: { file: 'dispatch-candidates.csv', columns: [0, 1, 2] },
    entryPoints: { file: 'entry-point.csv', columns: [0, 1] },
    entryReachable: { file: 'entry-reachable.csv', columns: [0] },
    typeInstantiated: { file: 'type-instantiated.csv', columns: [0, 1] },
    // site, caller, field, fieldProvenance, tier, access — the relation is already in this order
    fieldAccess: { file: 'field-access.csv', columns: [0, 1, 2, 3, 4, 5] },
    // ref, type, context, depth, ownerKind, owner, enclMethod, enclType, typeProv, tier
    typeUse: { file: 'type-use.csv', columns: [0, 5, 7, 8, 2, 1, 4, 3, 6, 9] },
    // key, mechanism, siteKind, site, prov — the relation is already in this order
    configBinding: { file: 'config-binding.csv', columns: [0, 1, 2, 3, 4] },
  },
  ir: {
    methods: {
      file: 'all-methods.csv', id: 'methodRegistryUniqueHash', name: 'name', qualifiedName: 'qualifiedName',
      signature: 'signature', kind: 'methodKind', ownerTypeId: 'typeRegistryLinkHash',
      ownerQualifiedName: 'ownerQualifiedName', filePath: 'filePath', startLine: 'startLine', endLine: 'endLine',
      access: 'methodAccess',
    },
    types: {
      file: 'all-types.csv', id: 'typeRegistryUniqueHash', name: 'name', qualifiedName: 'qualifiedName',
      category: 'typeCategory', filePath: 'filePath', startLine: 'startLine', endLine: 'endLine',
      access: 'typeAccess',
    },
    fields: {
      file: 'all-fields.csv', id: 'fieldRegistryUniqueHash', name: 'name', ownerTypeId: 'typeRegistryLinkHash',
      ownerQualifiedName: 'ownerQualifiedName', typeName: 'fieldTypeName', modifiers: 'fieldModifier',
      filePath: 'filePath', startLine: 'startLine', endLine: 'endLine',
      enumConstants: {
        file: 'all-enum-constants.csv', id: 'enumConstantUniqueHash', name: 'name',
        ownerTypeId: 'typeRegistryLinkHash', ownerQualifiedName: 'ownerQualifiedName',
        filePath: 'filePath', startLine: 'startLine', endLine: 'endLine',
      },
    },
    // A Java expression row carries no file; its owning type does.
    expressions: {
      file: 'all-expressions.csv', id: 'expressionUniqueHash', kind: 'kind',
      startLine: 'startLine', startColumn: 'startColumn', endLine: 'endLine', endColumn: 'endColumn',
      fileVia: { column: 'typeRegistryLinkHash', through: 'types' },
      // the parser puts the invoked name / created class name in literalValue for these kinds
      calleeName: { column: 'literalValue', kinds: ['METHOD_INVOCATION', 'OBJECT_CREATION', 'METHOD_REFERENCE', 'ANONYMOUS_CLASS_CREATION'] },
    },
    // The Java report carries no construct and no position: the three reasons it emits
    // (EMPTY_CONTENT, FILE_TOO_LARGE, READ_ERROR) are properties of the whole file.
    skipped: { file: 'skipped-java-files.csv', filePath: 'filePath', reason: 'reason' },
  },
};

const TYPESCRIPT: LanguageAdapter = {
  language: 'typescript',
  prefixes: { method: 'TS_METHOD_', type: 'TS_TYPE_', expression: 'TS_EXPRESSION_', module: 'TS_MODULE_' },
  raw: {
    callEdges: CALL_EDGES,
    typeAncestors: { file: 'resolution-type-ancestor.csv', columns: [0, 1] },
    entryPoints: { file: 'entry-point.csv', columns: [0, 1] },
    entryReachable: { file: 'entry-reachable.csv', columns: [0] },
    dispatchCandidates: { file: 'dispatch-candidates.csv', columns: [0, 1, 2] },
    // (type, how) — `new` is the only form TypeScript emits
    typeInstantiated: { file: 'resolution-type-instantiated.csv', columns: [0, 1] },
    fieldAccess: { file: 'field-access.csv', columns: [0, 1, 2, 3, 4, 5] },
    typeUse: { file: 'type-use.csv', columns: [0, 5, 7, 8, 2, 1, 4, 3, 6, 9] },
  },
  ir: {
    methods: {
      file: 'all-typescript-methods.csv', id: 'tsMethodUniqueHash', name: 'name', qualifiedName: 'qualifiedName',
      signature: 'signature', kind: 'methodKind', ownerTypeId: 'tsTypeLinkHash',
      ownerQualifiedName: 'ownerQualifiedName', filePath: 'filePath', startLine: 'startLine', endLine: 'endLine',
    },
    types: {
      file: 'all-typescript-types.csv', id: 'tsTypeUniqueHash', name: 'name', qualifiedName: 'qualifiedName',
      category: 'typeCategory', filePath: 'filePath', startLine: 'startLine', endLine: 'endLine',
    },
    // TypeScript has no separate enum-constant table shaped like Java's: an enum member is
    // reached through ts_enum_member, whose columns do not carry a declared type, and the
    // property-access relation resolves through ts_field. Only the field table is mapped.
    fields: {
      file: 'all-typescript-fields.csv', id: 'tsFieldUniqueHash', name: 'name', ownerTypeId: 'tsTypeLinkHash',
      ownerQualifiedName: 'ownerQualifiedName', typeName: 'fieldTypeName', modifiers: 'fieldModifier',
      filePath: 'filePath', startLine: 'startLine', endLine: 'endLine',
    },
    modules: { file: 'all-typescript-modules.csv', id: 'tsModuleUniqueHash', filePath: 'filePath' },
    expressions: {
      file: 'all-typescript-expressions.csv', id: 'tsExpressionUniqueHash', kind: 'kind',
      startLine: 'startLine', startColumn: 'startColumn', endLine: 'endLine', endColumn: 'endColumn',
      fileVia: { column: 'tsModuleLinkHash', through: 'modules' },
    },
    callSites: {
      file: 'all-typescript-call-sites.csv', expressionId: 'tsExpressionLinkHash', calleeName: 'calleeName',
      startLine: 'startLine', startColumn: 'startColumn',
      fileVia: { column: 'tsModuleLinkHash', through: 'modules' },
    },
    skipped: { file: 'skipped-typescript-files.csv', filePath: 'filePath', reason: 'reason', detail: 'detail' },
  },
};

const PYTHON: LanguageAdapter = {
  language: 'python',
  prefixes: { method: 'PY_METHOD_', type: 'PY_TYPE_', expression: 'PY_EXPRESSION_', module: 'PY_MODULE_', decorator: 'PY_DECORATOR_' },
  raw: {
    callEdges: CALL_EDGES,
    entryPoints: { file: 'entry-point.csv', columns: [0, 1] },
    entryReachable: { file: 'entry-reachable.csv', columns: [0] },
    // Python's ancestor relation carries a leading provenance column: (prov, type, ancestor)
    typeAncestors: { file: 'resolution-type-ancestor.csv', columns: [1, 2] },
    // (prov, type) — no "how"; every row is a constructor call
    typeInstantiated: { file: 'resolution-type-instantiated.csv', columns: [1], constant: 'new' },
    dispatchCandidates: { file: 'dispatch-candidates.csv', columns: [0, 1, 2] },
  },
  ir: {
    methods: {
      file: 'all-python-methods.csv', id: 'pyMethodUniqueHash', name: 'name', qualifiedName: 'qualifiedName',
      signature: 'signature', kind: 'methodKind', ownerTypeId: 'pyTypeLinkHash',
      ownerQualifiedName: 'ownerQualifiedName', filePath: 'filePath', startLine: 'startLine', endLine: 'endLine',
    },
    types: {
      file: 'all-python-types.csv', id: 'pyTypeUniqueHash', name: 'name', qualifiedName: 'qualifiedName',
      category: 'typeCategory', filePath: 'filePath', startLine: 'startLine', endLine: 'endLine',
    },
    modules: { file: 'all-python-modules.csv', id: 'pyModuleUniqueHash', filePath: 'filePath' },
    expressions: {
      file: 'all-python-expressions.csv', id: 'pyExpressionUniqueHash', kind: 'kind',
      startLine: 'startLine', startColumn: 'startColumn', endLine: 'endLine', endColumn: 'endColumn',
      fileVia: { column: 'pyModuleLinkHash', through: 'modules' },
    },
    callSites: {
      file: 'all-python-call-sites.csv', expressionId: 'pyExpressionLinkHash', calleeName: 'calleeName',
      startLine: 'startLine', startColumn: 'startColumn', endLine: 'endLine',
      fileVia: { column: 'pyModuleLinkHash', through: 'modules' },
    },
    decorators: {
      file: 'all-python-decorators.csv', id: 'pyDecoratorUniqueHash', expressionId: 'pyExpressionLinkHash', name: 'decoratorName',
      startLine: 'startLine', endLine: 'endLine',
      fileVia: { column: 'pyModuleLinkHash', through: 'modules' },
    },
    // The only report that positions the rejection: a PY2_CONSTRUCT_DETECTED row names the
    // construct and the line and column it was written at.
    skipped: {
      file: 'skipped-python-files.csv', filePath: 'filePath', reason: 'reason', construct: 'construct',
      startLine: 'startLine', startColumn: 'startColumn', detail: 'detail',
    },
  },
};

const JAVASCRIPT: LanguageAdapter = {
  language: 'javascript',
  prefixes: { method: 'JS_METHOD_', type: 'JS_TYPE_', expression: 'JS_EXPRESSION_', module: 'JS_MODULE_' },
  raw: {
    callEdges: CALL_EDGES,
    typeAncestors: { file: 'resolution-type-ancestor.csv', columns: [0, 1] },
    entryPoints: { file: 'entry-point.csv', columns: [0, 1] },
    entryReachable: { file: 'entry-reachable.csv', columns: [0] },
  },
  ir: {
    // No signature and no owner qualified name: JavaScript declares neither.
    // A library method's qualifiedName and filePath are relative to ITS package root and
    // carry no package: `index.run` in `index.js` for every package with an index.js. The
    // bundle prefixes them with the owning module's package (ModulesIR.packageName).
    methods: {
      file: 'all-javascript-methods.csv', id: 'jsMethodUniqueHash', name: 'name', qualifiedName: 'qualifiedName',
      kind: 'methodKind', ownerTypeId: 'ownerTypeLinkHash',
      filePath: 'filePath', startLine: 'startLine', endLine: 'endLine', moduleId: 'ownerModuleLinkHash',
    },
    types: {
      file: 'all-javascript-types.csv', id: 'jsTypeUniqueHash', name: 'name', qualifiedName: 'qualifiedName',
      category: 'typeCategory', filePath: 'filePath', startLine: 'startLine', endLine: 'endLine', moduleId: 'ownerModuleLinkHash',
    },
    modules: { file: 'all-javascript-modules.csv', id: 'jsModuleUniqueHash', filePath: 'filePath', packageName: 'packageName', basePath: 'baseMservPath' },
    expressions: {
      file: 'all-javascript-expressions.csv', id: 'jsExpressionUniqueHash', kind: 'expressionKind',
      startLine: 'startLine', startColumn: 'startColumn', endLine: 'endLine', endColumn: 'endColumn',
      fileVia: { column: 'ownerModuleLinkHash', through: 'modules' },
    },
    callSites: {
      file: 'all-javascript-call-sites.csv', expressionId: 'expressionLinkHash', calleeName: 'calleeName',
      startLine: 'startLine', startColumn: 'startColumn',
      fileVia: { column: 'ownerModuleLinkHash', through: 'modules' },
    },
    // A DIRECTORY_EXCLUDED row names a PRUNED DIRECTORY and not a file, with the count of
    // files behind it in `detail` — see the note on the `skipped` table in schema.ts.
    skipped: { file: 'skipped-javascript-files.csv', filePath: 'filePath', reason: 'reason', detail: 'detail' },
  },
};

const CSHARP: LanguageAdapter = {
  language: 'csharp',
  prefixes: { method: 'CS_METHOD_', type: 'CS_TYPE_', expression: 'CS_EXPRESSION_', module: 'CS_MODULE_' },
  raw: {
    callEdges: CALL_EDGES,
    typeAncestors: { file: 'resolution-type-ancestor.csv', columns: [1, 2] },
    entryPoints: { file: 'entry-point.csv', columns: [0, 1] },
    entryReachable: { file: 'entry-reachable.csv', columns: [0] },
    dispatchCandidates: { file: 'dispatch-candidates.csv', columns: [0, 1, 2] },
    // (prov, type) — no "how"; every row is a construction
    typeInstantiated: { file: 'resolution-type-instantiated.csv', columns: [1], constant: 'new' },
  },
  ir: {
    // A C# method row carries BOTH its module and its type, and the type is empty for a
    // top-level-statements entry point and for a local function. ownerTypeId is therefore
    // legitimately blank on some rows, and the file comes from moduleId rather than from
    // the owning type — which is why moduleId is set here and is not on the Java adapter.
    methods: {
      file: 'all-csharp-methods.csv', id: 'csMethodUniqueHash', name: 'name', qualifiedName: 'qualifiedName',
      signature: 'signature', kind: 'methodKind', ownerTypeId: 'csTypeLinkHash',
      // cs_method has no owner name column; the owner's type row supplies it (#1247)
      ownerQualifiedNameFromType: true,
      startLine: 'startLine', endLine: 'endLine', moduleId: 'csModuleLinkHash',
    },
    types: {
      file: 'all-csharp-types.csv', id: 'csTypeUniqueHash', name: 'name', qualifiedName: 'qualifiedName',
      category: 'typeCategory', startLine: 'startLine', endLine: 'endLine',
      moduleId: 'csModuleLinkHash',
    },
    // cs_field carries ordinary fields AND const members; a C# enum member is its own
    // relation and is not mapped here, because unlike a Java enum constant it has no
    // declared type column and is reached through cs_enum_member instead.
    fields: {
      file: 'all-csharp-fields.csv', id: 'csFieldUniqueHash', name: 'name', ownerTypeId: 'csTypeLinkHash',
      typeName: 'fieldTypeName', modifiers: 'fieldModifiers', ownerQualifiedNameFromType: true,
      startLine: 'startLine', endLine: 'endLine', moduleId: 'csModuleLinkHash',
    },
    modules: { file: 'all-csharp-modules.csv', id: 'csModuleUniqueHash', filePath: 'filePath' },
    // A C# expression row carries its own module, so the file comes straight off it.
    expressions: {
      file: 'all-csharp-expressions.csv', id: 'csExpressionUniqueHash', kind: 'kind',
      startLine: 'startLine', startColumn: 'startColumn', endLine: 'endLine', endColumn: 'endColumn',
      fileVia: { column: 'csModuleLinkHash', through: 'modules' },
    },
    callSites: {
      file: 'all-csharp-call-sites.csv', expressionId: 'csExpressionLinkHash', calleeName: 'calleeName',
      startLine: 'startLine', startColumn: 'startColumn',
      fileVia: { column: 'csModuleLinkHash', through: 'modules' },
    },
    // No `skipped` entry: the C# front end writes no skipped-files report at all. Its
    // grammar gate takes the opposite line — a construct the grammar does not cover is a
    // failed run, not a skipped file (parser/src/parsers/csharp/grammar-gate.ts) — so
    // there is no CSV to stage and `skipped` is legitimately empty for csharp. Pointing the
    // adapter at a file the parser never writes would only produce the same empty table
    // while claiming a source that does not exist.
  },
};

export const ADAPTERS: Record<Language, LanguageAdapter> = { java: JAVA, typescript: TYPESCRIPT, python: PYTHON, javascript: JAVASCRIPT, csharp: CSHARP };

export function adapterFor(language: string): LanguageAdapter {
  const a = (ADAPTERS as Record<string, LanguageAdapter>)[language];
  if (!a) throw new Error(`no output adapter for --language=${language} (have: ${Object.keys(ADAPTERS).join(', ')})`);
  return a;
}
