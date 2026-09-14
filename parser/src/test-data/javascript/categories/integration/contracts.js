// fixture: cjs/integration/contracts.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: TYPE-ONLY. No statement, no binding, no export. The whole file is
//   comments, exactly as jsdoc/typedef-only.js is — repeated here because an
//   integration corpus that has no type-only module cannot show a type-only
//   module being consumed by a runtime-bearing one without leaking.
// syntax floor: none
//
// The contracts the rest of the integration set is written against. Every type
// here is COMMENT_ONLY, isTypeOnly = true, and no js_call_site anywhere in this
// directory may resolve to one.

/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} email
 * @property {'admin'|'member'|'guest'} role
 * @property {Date} createdAt
 * @property {?Profile} profile
 */

/**
 * @typedef {Object} Profile
 * @property {string} displayName
 * @property {string} [avatarUrl]
 */

/**
 * @typedef {Object} Page
 * @property {number} offset
 * @property {number} limit
 */

/**
 * The repository contract. Implemented twice — once as an ES class and once as
 * a constructor function — and declared by neither, because JavaScript has no
 * `implements`.
 *
 * @typedef {Object} UserRepository
 * @property {function(string): Promise<?User>} findById
 * @property {function(Page): Promise<Array<User>>} list
 * @property {function(User): Promise<User>} save
 */

/**
 * @callback ErrorHandler
 * @param {Error} error
 * @param {string} context
 * @returns {void}
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: Error }} Result
 */
