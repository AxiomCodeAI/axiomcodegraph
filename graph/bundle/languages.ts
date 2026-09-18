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
  ownerTypeId: string; filePath: string; startLine: string; endLine: string;
  /** absent where the IR has no such column (JavaScript declares no signatures); the core column is then '' / NULL */
  signature?: string; ownerQualifiedName?: string;
  /** the column naming the owning module, where a LIBRARY row's names are relative to its own package root and need the package prefixed (see ModulesIR.packageName) */
  moduleId?: string;
}
export interface TypesIR {
  file: string; id: string; name: string; qualifiedName: string; category: string;
  filePath: string; startLine: string; endLine: string;
  moduleId?: string;
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
  filePath: string; startLine: string; endLine: string;
  /** a second file holding enum constants, with the same column roles */
  enumConstants?: { file: string; id: string; name: string; ownerTypeId: string; ownerQualifiedName?: string; filePath: string; startLine: string; endLine: string };
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
    },
    types: {
      file: 'all-types.csv', id: 'typeRegistryUniqueHash', name: 'name', qualifiedName: 'qualifiedName',
      category: 'typeCategory', filePath: 'filePath', startLine: 'startLine', endLine: 'endLine',
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
  },
};

const PYTHON: LanguageAdapter = {
  language: 'python',
  prefixes: { method: 'PY_METHOD_', type: 'PY_TYPE_', expression: 'PY_EXPRESSION_', module: 'PY_MODULE_', decorator: 'PY_DECORATOR_' },
  raw: {
    callEdges: CALL_EDGES,
    entryPoints: { file: 'entry-point.csv', columns: [0, 1] },
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
  },
};

export const ADAPTERS: Record<Language, LanguageAdapter> = { java: JAVA, typescript: TYPESCRIPT, python: PYTHON, javascript: JAVASCRIPT };

export function adapterFor(language: string): LanguageAdapter {
  const a = (ADAPTERS as Record<string, LanguageAdapter>)[language];
  if (!a) throw new Error(`no output adapter for --language=${language} (have: ${Object.keys(ADAPTERS).join(', ')})`);
  return a;
}
