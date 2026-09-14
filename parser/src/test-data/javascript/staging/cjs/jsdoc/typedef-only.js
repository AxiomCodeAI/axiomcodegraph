// fixture: cjs/jsdoc/typedef-only.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: TYPE-ONLY. There is no executable statement in this file. Not one
//   declaration, not one call, not one binding. Every type it declares exists
//   ONLY as a comment.
// syntax floor: none — the file contains no JavaScript syntax at all beyond
//   comments and a single `module.exports` free of value (see the last line and
//   the note about it).
//
// js_type rows with evidenceKind = COMMENT_ONLY, declarationForm = JSDOC_TYPEDEF,
// isTypeOnly = true, and a startLine INSIDE a comment. 677 @typedef sites in the
// schema's corpus.
//
// This is the fixture the type-only gate is written against: if any js_call_site
// or js_expression row originates here, the parser is leaking type-only
// constructs into the call graph, and that is a bug rather than a corpus gap.
// The check can only mean that if the file says which it is, which is why the
// nature line above is not decoration.
//
// Grounded in the `types.js` / `typedefs.js` file that JSDoc-typed projects keep
// as a central type registry — a charting library, a media player and every
// Closure-annotated codebase have one.

/**
 * A single HTTP header, as a name/value pair.
 *
 * @typedef {Object} Header
 * @property {string} name  the header name, lowercased
 * @property {string} value the header value, unparsed
 * @property {boolean} [singleton] whether repeating it is an error
 */

/**
 * A parsed request. Composed entirely of other typedefs in this file, which is
 * what makes the FK from one comment-declared type to another a normal FK.
 *
 * @typedef {Object} Request
 * @property {string} method
 * @property {string} url
 * @property {Header[]} headers
 * @property {Object<string, string>} query
 * @property {?Body} body            nullable
 * @property {!Socket} socket        non-nullable (Closure syntax)
 * @property {Request} [parent]      recursive, and optional
 */

/**
 * A union typedef. The type is not an object at all.
 *
 * @typedef {string | Buffer | ReadableStream | null} Body
 */

/**
 * An intersection.
 *
 * @typedef {Request & { authenticated: true, user: User }} AuthenticatedRequest
 */

/**
 * A typedef whose right-hand side is a FUNCTION TYPE rather than a @callback.
 * Both spellings exist and mean the same thing.
 *
 * @typedef {function(Request, Response): void} Middleware
 */

/**
 * A generic typedef. @template on a typedef is the only "type parameter" in
 * JavaScript, and the schema deliberately gives it no relation of its own:
 * it lives in js_type_reference with contextKind = TEMPLATE.
 *
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: Error }} Result
 */

/**
 * A typedef referring to a type declared in ANOTHER FILE, by import type
 * syntax. This is a module edge that exists only inside a comment — the
 * specifier is a string literal in a type position, and it resolves the same
 * way any other specifier does.
 *
 * @typedef {import('./extends-implements.js').Emitter} ImportedEmitter
 */

/**
 * A typedef for a type that DOES NOT EXIST anywhere. Nothing declares
 * `LegacyOptions`, in this file or any other. The honest row names the type and
 * resolves nothing; there is no more evidence available.
 *
 * @typedef {LegacyOptions} StillUndeclared
 */

/**
 * A tuple, a record with numeric-ish keys, an array of unions, and a nested
 * generic three deep — the type-expression TREE, which js_type_reference stores
 * as one row per node rather than as a string.
 *
 * @typedef {[number, string, ...boolean[]]} Triple
 * @typedef {Array<Object<string, Array<Header>>>} DeepNesting
 * @typedef {Object<number, (string|number)[]>} MixedMap
 */

/**
 * The remaining shapes: a rest parameter in a function type, an optional
 * parameter, `*` (any), `?` (unknown), and a `this` type.
 *
 * @typedef {function(this:Request, string=, ...number): *} OddSignature
 * @typedef {*} Anything
 * @typedef {?} Unknown
 */

/**
 * An @enum. Closure's spelling of a constant set, and the values live in the
 * object it annotates — which in this file is nowhere, so the enum has a type
 * and no members.
 *
 * @enum {string}
 */

// Deliberately NOT exported and deliberately no code. Adding
// `module.exports = {}` here would make the file runtime-bearing and destroy
// the only property it is here to prove.
