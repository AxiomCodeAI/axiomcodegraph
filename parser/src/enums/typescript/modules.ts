/**
 * `ts_module` enums — schema §4.1.
 *
 * A TypeScript module is three things at once and this file names all three:
 * the unit of import resolution, the symbol MERGE TABLE (§3.1), and the
 * boundary between module scope and global scope. Java's package is implicit
 * in a qualified name and needs no relation; this does.
 */

/** `ts_module` c5 — what kind of module row this is. */
export enum TsModuleKind {
  /** A `.ts`/`.mts`/`.cts` file with a top-level `import` or `export`. */
  SOURCE_MODULE = 'SOURCE_MODULE',
  /** A file with NO top-level import/export: its declarations land in GLOBAL scope. */
  SCRIPT_GLOBAL = 'SCRIPT_GLOBAL',
  /** A `.d.ts` file. */
  DECLARATION_FILE = 'DECLARATION_FILE',
  /** `declare module "x" { … }` where `x` is not a relative path — its own importable namespace. */
  AMBIENT_MODULE_DECLARATION = 'AMBIENT_MODULE_DECLARATION',
  /** `declare module "./local" { … }` — merges INTO an existing module (§3.1). */
  MODULE_AUGMENTATION = 'MODULE_AUGMENTATION',
  /** `declare global { … }`. */
  GLOBAL_AUGMENTATION = 'GLOBAL_AUGMENTATION',
  JSON_MODULE = 'JSON_MODULE',
}

/** `ts_module` c6 — `ts.ScriptKind`, which decides whether `<` opens JSX. */
export enum TsScriptKind {
  TS = 'TS',
  TSX = 'TSX',
  DTS = 'DTS',
  MTS = 'MTS',
  CTS = 'CTS',
  JSON = 'JSON',
}

/**
 * `ts_module` c16 — the emission regime, and it is IN THE PRIMARY KEY.
 *
 * Coarse on purpose (OQ-4). `targetTsVersion` carries `6.0.3` as non-key
 * provenance; putting a patch version in a key would cascade every child hash
 * on a patch bump. What must be distinguishable from inside the fact base is
 * the REGIME: a 6.x in-process parse versus a future 7.x out-of-process one,
 * which produce structurally different fact sets.
 */
export enum TsEmissionRegime {
  /** `ts.createSourceFile` from an in-process `typescript@6.x`. */
  TS6_INPROC = 'ts6-inproc',
}

/** `ts_module` c13 — from the GOVERNING tsconfig, never assumed. */
export enum TsModuleResolutionMode {
  NODE16 = 'NODE16',
  NODENEXT = 'NODENEXT',
  BUNDLER = 'BUNDLER',
  NODE10 = 'NODE10',
  CLASSIC = 'CLASSIC',
}

/**
 * `ts_module` c12 / `ts_type` c16 — the §3.1 merge-table key prefixes.
 *
 * These are PREFIXES, not whole values: everything but `GLOBAL` is followed by
 * `:` and a hash. They are named here so a typo in one extractor cannot make a
 * declaration merge with nothing, which is silent and looks like correct output.
 */
export const TS_MERGE_SCOPE = {
  /** Exported from a module file — the module symbol's `exports` table. */
  MODULE_EXPORTS: 'MODULE_EXPORTS',
  /** Declared but not exported — the source file's `locals` table. */
  MODULE_LOCALS: 'MODULE_LOCALS',
  /** A global script, or inside `declare global`. Whole value, no suffix. */
  GLOBAL: 'GLOBAL',
  /** Exported from a namespace — keyed by the NAMESPACE's own group key. */
  NS: 'NS',
  /** Inside a function body or a block — keyed by the binder scope, not the method (see note). */
  LOCALS: 'LOCALS',
} as const;
