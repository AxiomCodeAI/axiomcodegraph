/**
 * Whether this file is CommonJS or an ES module. Schema §3.1 c7, **in the
 * primary key**.
 *
 * ## Why a two-value enum sits in a primary key
 *
 * `import` in a file governed by `"type": "commonjs"` is a syntax error at
 * runtime. `require` in a file governed by `"type": "module"` is `undefined`.
 * They are not two spellings of one program — they are two different programs,
 * and the source bytes are identical either way.
 *
 * So the deciding input is a `package.json` **the file does not contain**, and
 * 91.4% of measured files are decided by *default* rather than by declaration.
 * Editing a `"type"` field three directories up genuinely changes this file's
 * facts. Keying on it means the before and after are two distinguishable fact
 * sets rather than one silently overwriting the other.
 *
 * `governingPackageJsonPath` is deliberately **not** in the key: it is the
 * evidence for this conclusion, and evidence moving without the conclusion
 * moving must not cascade every child hash.
 */
export enum JsModuleSystem {
  /** `require`/`module.exports`. The default when nothing says otherwise. */
  COMMONJS = 'COMMONJS',

  /** `import`/`export`. Always strict mode, with a real temporal dead zone. */
  ESM = 'ESM',
}
