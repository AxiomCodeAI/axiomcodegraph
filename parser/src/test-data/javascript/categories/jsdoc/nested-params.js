// fixture: cjs/jsdoc/nested-params.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2018
//
// THE DOTTED `@param` AND THE BRACKET FORMS, isolated.
//
// `cjs/jsdoc/param-returns.js` already contained dotted `@param` names, and it
// did NOT catch the defect js-impl found — its dotted tags hang off a
// DESTRUCTURED parameter and the row came out empty rather than wrong. Having
// the construct is not the same as discriminating on it, which is why this file
// exists beside that one rather than inside it.
//
// ## What actually happens, measured against the parser at 2d5a4dc
//
// A dotted `@param` following a plain-identifier parent puts **the raw remaining
// comment text** into the parent's `declaredTypeName` — sibling tags, newlines,
// leading asterisks and all:
//
//     @param {object} ctx        ->  declaredTypeName =
//     @param {string} ctx.model      "@param {string} ctx.model\n * @param {number} ctx.version\n * "
//     @param {number} ctx.version
//
// Five shapes reproduce it: no trailing tag, a trailing `@returns`, a trailing
// plain `@param`, trailing prose, and two levels of nesting.
//
// ## Two corrections to how this was described to me
//
// 1. **The positional count is NOT wrong.** A later plain `@param` still lands
//    at the right position with the right type — in `withLaterPlainParam` below,
//    `limit` is position 1 with `declaredTypeName = "number"`. Only the
//    parent's type text is corrupted. Worth stating because "counted as a
//    positional parameter" would send someone looking at `position`, which is
//    correct — and `outOfOrderTags` shows tags are matched to parameters BY
//    NAME rather than by order, which is also correct and also worth not
//    breaking while fixing the rest.
//
// 2. **The bracket forms have a SEPARATE defect nobody named**, and the
//    fixture pins its exact shape. `@param {string} [x]` and
//    `@param {string} [x=y]` extract their TYPE correctly — `"string"` — and set
//    **`isOptional = false`, `hasDefault = false`**. The schema documents
//    `isOptional` as "JSDoc `[x]` **or** a default value".
//
//    `defaultsDisagree` below is what makes the diagnosis precise: it is the
//    only bracketed parameter in this file that also has a default IN THE CODE,
//    and it is the only one that comes back `true, true`. So the two columns are
//    being derived **from the code alone** — the bracket is parsed for its type
//    and its optionality is discarded on the way past. A silent loss, not a
//    corruption, which is why no amount of looking at `declaredTypeName` finds
//    it.
//
// Grounded in the shape every options-object API documents itself with — a web
// framework's `app.listen(options)`, the platform's `fs.readFile(path, options)`, and any function
// whose second argument is a config bag.

'use strict';

// --- the dotted form, five shapes ------------------------------------------------

/**
 * Parent is a plain identifier, dotted children follow, nothing after them.
 *
 * @param {object} ctx
 * @param {string} ctx.model
 * @param {number} ctx.version
 */
function noTrailingTag(ctx) {
  return ctx.model + ctx.version;
}

/**
 * The same, with a trailing `@returns`. A trailing tag does NOT stop it.
 *
 * @param {object} scope
 * @param {string} scope.name
 * @returns {string}
 */
function withReturns(scope) {
  return scope.name;
}

/**
 * A later PLAIN `@param` after the dotted ones. This is the case that proves
 * the positional count is unaffected: `limit` must be position 1 with type
 * `number`, and it is.
 *
 * @param {object} query
 * @param {string} query.table
 * @param {number} limit
 */
function withLaterPlainParam(query, limit) {
  return query.table + limit;
}

/**
 * Dotted children followed by prose rather than by a tag.
 *
 * @param {object} opts
 * @param {boolean} opts.strict
 *
 * Remaining prose, deliberately after the last tag, describing nothing.
 */
function withTrailingProse(opts) {
  return opts.strict;
}

/**
 * Two levels of nesting. `o.a.b` has a dotted parent which itself has a dotted
 * parent, and neither level is a parameter.
 *
 * @param {object} tree
 * @param {object} tree.branch
 * @param {string} tree.branch.leaf
 * @returns {string}
 */
function deeplyDotted(tree) {
  return tree.branch.leaf;
}

/**
 * A dotted `@param` whose PARENT TAG IS ABSENT. Nothing declares `orphan`
 * itself, only its child, so there is no parent row for the child to attach to.
 *
 * @param {string} orphan.child
 */
function orphanDotted(orphan) {
  return orphan.child;
}

/**
 * Dotted names on a DESTRUCTURED parameter — the shape param-returns.js already
 * had, kept here so the two are side by side and the difference is legible.
 * One `js_method_parameter` row with `name = ""`, plus the bound names.
 *
 * @param {object} config
 * @param {string} config.host
 * @param {number} config.port
 */
function destructuredParent({ host, port }) {
  return host + ':' + port;
}

// --- the bracket forms ----------------------------------------------------------------

/**
 * Optional, no default. `isOptional` must be true.
 *
 * @param {string} [maybeMissing]
 * @returns {string}
 */
function optionalOnly(maybeMissing) {
  return maybeMissing || '';
}

/**
 * Optional WITH a default, declared only in the comment — the code has no
 * default at all, so `hasDefault` is a claim the JSDoc makes alone.
 *
 * @param {string} [withCommentDefault=fallback]
 * @returns {string}
 */
function defaultInCommentOnly(withCommentDefault) {
  return withCommentDefault;
}

/**
 * Optional in the comment AND defaulted in the code, with DIFFERENT defaults.
 * Both are written, both must be emitted, and neither adjudicates the other.
 *
 * @param {number} [disagreeing=1]
 * @returns {number}
 */
function defaultsDisagree(disagreeing = 99) {
  return disagreeing;
}

/**
 * A defaulted value containing the characters that terminate the form — an
 * equals sign and a bracket inside the default itself.
 *
 * @param {string} [tricky=a=b]
 * @param {string} [alsoTricky=[1,2]]
 */
function trickyDefaults(tricky, alsoTricky) {
  return tricky + alsoTricky;
}

/**
 * Bracketed AND dotted together — an optional member of an options object,
 * which is the single commonest JSDoc shape in a real codebase.
 *
 * @param {object} settings
 * @param {string} settings.required
 * @param {number} [settings.optional=30]
 * @returns {number}
 */
function bracketedAndDotted(settings) {
  return settings.optional || 0;
}

// --- a @param naming a parameter that does not exist ------------------------------------

/**
 * The tag names `ghost`; the function takes `actual`. JSDoc that contradicts the
 * code is legitimate — it rots the moment a signature changes and nothing checks
 * it — and the parser's job is to emit what is written, not to adjudicate.
 *
 * Measured: `actual` gets `declaredTypeName = ""` and the tag is dropped
 * entirely. Nothing in the fact base records that the comment named a parameter
 * the function does not have, so the contradiction is unrecoverable.
 *
 * @param {string} ghost
 * @returns {string}
 */
function namesNoSuchParameter(actual) {
  return actual;
}

/**
 * Two tags for one parameter, the second contradicting the first, plus a tag
 * for a parameter that exists at a DIFFERENT position.
 *
 * @param {string} second
 * @param {number} first
 */
function outOfOrderTags(first, second) {
  return String(first) + second;
}

module.exports = {
  noTrailingTag, withReturns, withLaterPlainParam, withTrailingProse,
  deeplyDotted, orphanDotted, destructuredParent,
  optionalOnly, defaultInCommentOnly, defaultsDisagree, trickyDefaults,
  bracketedAndDotted, namesNoSuchParameter, outOfOrderTags
};
