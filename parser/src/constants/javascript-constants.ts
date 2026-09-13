/**
 * JavaScript-specific parser constants.
 *
 * The parse layer is `ts.createSourceFile` with a JavaScript `ScriptKind`, the
 * same one the TypeScript front end uses, so nothing here is about tree-sitter's
 * 32,767-character buffer. What *is* JavaScript-specific lives here: the depth
 * cap the corpus forced up from TypeScript's, the synthetic names, and the
 * governing-config defaults that decide whether a `.js` file is CommonJS or ESM.
 */

/**
 * The exact compiler this analysis parses with. Recorded in every `js_module`
 * row as `targetTsVersion`, and paired with invariant #10 of the schema: a
 * golden file emitted by a different compiler fails the gate rather than being
 * reconciled.
 *
 * Deliberately NOT in any primary key — see {@link JS_EMISSION_REGIME}.
 */
export const JS_TARGET_VERSION = '6.0.3';

/**
 * The regime token stamped into `js_module`'s PRIMARY KEY.
 *
 * Coarse, for the same reason `ts_module`'s is: the module hash chains into
 * every child key, so a patch bump in a key would invalidate the whole fact
 * base for a change that alters no fact. What must be distinguishable from
 * inside the table is the regime — a 6.x in-process parse versus a future
 * out-of-process one — not the patch level.
 */
export const JS_EMISSION_REGIME = 'js-ts6-inproc';

/**
 * Maximum expression-tree depth recorded in `js_expression`.
 *
 * **32, not TypeScript's effective ceiling of 20.** The schema measured a
 * maximum AST depth of 67 and a p99 of 26 over 2,738 real JavaScript files, so
 * a cap of 20 truncates code that actually exists — promise chains and
 * two large library trees both reach past it. Deeper nodes are dropped with the parent
 * marked `isTruncated`, so a lost subtree is visible rather than silent.
 */
export const JS_EXPRESSION_MAX_DEPTH = 32;

/** Same cap for the JSDoc type tree, for the same reason. */
export const JS_TYPE_REFERENCE_MAX_DEPTH = 32;

/** `js_expression.text` is truncated here; the schema states 512. */
export const JS_EXPRESSION_TEXT_LIMIT = 512;

/** `js_comment.text` is truncated here; the schema states 2,048. */
export const JS_COMMENT_TEXT_LIMIT = 2_048;

/**
 * Synthetic method minted per module so top-level executable code always has an
 * owner.
 *
 * In JavaScript this carries more weight than in TypeScript: a CommonJS file's
 * top level is genuinely a function body at runtime (Node wraps it), and the
 * 83.6% of module edges that are expression-borne all hang off this row.
 */
export const JS_MODULE_INITIALIZER_NAME = '<module>';

/** `js_method.name` for the unnamed function-shaped declarations. */
export const JS_ANONYMOUS_METHOD_NAMES = {
  CONSTRUCTOR: '<constructor>',
  ARROW: '<arrow>',
  FUNCTION_EXPRESSION: '<function-expression>',
  STATIC_BLOCK: '<static-block>',
} as const;

/** `js_type.name` for a class with no name of its own. */
export const JS_ANONYMOUS_TYPE_NAME = '<anonymous-class>';

/** The exported name a `module.exports = X` edge carries. */
export const JS_DEFAULT_EXPORT_NAME = 'default';

/**
 * File extensions the analyzer treats as JavaScript source.
 *
 * `.mjs` and `.cjs` are here because they OVERRIDE the governing
 * `package.json` outright — they are not spelling variants, they are the only
 * two ways a file states its own module system.
 *
 * ## Flow declaration files are NOT spelled here, deliberately
 *
 * Flow is out of scope, and the ruling is that a rejection must be RECORDED
 * rather than absent: a declined file emits one `js_module` row with
 * `sourceProvenance = FLOW_REJECTED` so a consumer can count what was refused.
 *
 * That only works if the file is discovered, and `.js.flow` was first added to
 * THIS LIST — which fixed one spelling and left the class: `.cjs.flow` and
 * `.mjs.flow` are equally legal and were still invisible, because the list held
 * a literal string rather than describing the shape.
 *
 * Flow's convention is `<name>.<ext>.flow`, so the rule is "a JavaScript
 * extension, optionally followed by `.flow`" and it lives in
 * `jsExtensionOf` — one place that knows `path.extname` returns only the last
 * part. This list stays what its name says: the JavaScript extensions.
 */
export const JS_SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'] as const;

/**
 * Directories that contain JavaScript but are never the project under analysis.
 *
 * `node_modules` and `bower_components` are excluded by NAME, not as a scale
 * optimisation: those files are real source, and analysing them as PROJECT code
 * stages third-party declarations into the wrong provenance bucket. The rest are
 * build *output* directories — the artefact, never the input.
 *
 * ## What is deliberately NOT here, and why it was removed
 *
 * `vendor` and `min` were on this list for one commit, and the day-one gate
 * caught it: excluding them by directory name made
 * `sourceProvenance = BUNDLED` **unemittable**, because a bundle that
 * is never walked cannot be classified. The schema's rule is *classified, never
 * counted*, and gate 7.3.5 asserts such a file contributes zero rows to any
 * denominator — which is only checkable if the file is in the fact base saying
 * what it is. A silent directory skip and a classified row look identical in a
 * row count and are opposite claims.
 *
 * `vendor/` is also frequently hand-vendored real source rather than output, so
 * the name is not evidence of anything. Detection belongs in
 * `provenanceOf` — a `.min.js`-shaped name or a line no human writes — where the
 * answer lands in a column.
 */
export const JS_SKIP_DIRECTORIES = [
  'node_modules', 'bower_components', '.git', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.turbo', '.cache', '.yarn',
] as const;

/**
 * A line longer than this is ONE of the two signals that mark a file as
 * bundled output — never the only one (ruled 2026-09-13).
 *
 * Bundled JavaScript is real and valid and will dominate any row count in a
 * corpus that does not exclude it, while teaching nothing. It is LABELLED
 * (`sourceProvenance = BUNDLED`) and emitted in full; denominators exclude it
 * by column.
 *
 * ## What the length signal is worth, measured
 *
 * On the development corpus (js-corpus, 4,529 files): 19 files labelled
 * BUNDLED, 17 by name and 3 by length — and every length catch that was a
 * real bundle was ALSO caught by name. The one file caught by length alone
 * was a 399-line hand-written CommonJS file with a 7,286-character regex
 * literal, which this comment used to say could not happen. **Zero unique
 * true positives, one false positive.** It stays because that is a statement
 * about a corpus, not the language: a bundler-emitted `dist/index.js` with no
 * name marker is a real shape that is simply not in that corpus — and it will
 * carry a `sourceMappingURL` footer or a runtime preamble. So the rule is
 * length AND a content signal; a single long LITERAL is excused, because
 * source can have one long line without being generated.
 */
export const JS_BUNDLED_LINE_LENGTH_THRESHOLD = 5_000;

/**
 * A `.min.js`-style name is bundled output whatever its line lengths are.
 *
 * DROP MODULE-FORMAT MARKERS, KEEP BUILD-PRODUCT MARKERS (ruled 2026-09-13).
 * `min` and `bundle` name a build product — a tool writes `foo.min.js`.
 * `esm` and `umd` name a MODULE FORMAT, how the code is packaged for a
 * loader — a person writes `index.esm.js` and `Foo.umd.js`. Measured by
 * js-corpus: `.min.` 17 hits, all real; `.umd.` 2, both hand-written (39
 * lines, eight imports, longest line 81, PROJECT under a neutral name);
 * `.esm.` zero. Where a name signal and a content signal disagree the content
 * wins, because including a bundle inflates a denominator detectably while
 * deleting real source leaves nothing to notice.
 */
export const JS_MINIFIED_NAME_PATTERN = /\.(min|bundle)\.[cm]?jsx?$/i;

/** CSV file names for the JavaScript fact tables. */
export const JAVASCRIPT_CSV_FILES = {
  MODULES: 'all-javascript-modules.csv',
  SCOPES: 'all-javascript-scopes.csv',
  TYPES: 'all-javascript-types.csv',
  TYPE_HERITAGES: 'all-javascript-type-heritages.csv',
  TYPE_REFERENCES: 'all-javascript-type-references.csv',
  METHODS: 'all-javascript-methods.csv',
  METHOD_PARAMETERS: 'all-javascript-method-parameters.csv',
  FIELDS: 'all-javascript-fields.csv',
  VARIABLES: 'all-javascript-variables.csv',
  IMPORTS: 'all-javascript-imports.csv',
  EXPORTS: 'all-javascript-exports.csv',
  EXPRESSIONS: 'all-javascript-expressions.csv',
  CALL_SITES: 'all-javascript-call-sites.csv',
  BLOCKS: 'all-javascript-blocks.csv',
  COMMENTS: 'all-javascript-comments.csv',
  PARSE_GAPS: 'all-javascript-parse-gaps.csv',
  SKIPPED_FILES: 'skipped-javascript-files.csv',
} as const;

/** Chunk size for CSV writes, matching the Java, Python and TypeScript analyzers. */
export const JS_CSV_CHUNK_SIZE = 50_000;
