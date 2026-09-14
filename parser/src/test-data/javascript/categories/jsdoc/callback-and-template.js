// fixture: cjs/jsdoc/callback-and-template.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// @callback and @template. 109 @callback and 1,013 @template sites in the
// schema's corpus.
//
// @callback declares a FUNCTION TYPE with a name — typeCategory =
// JSDOC_CALLBACK, isTypeOnly = true. It looks exactly like a function
// declaration in a comment and it is not one: nothing is callable, and a
// js_call_site whose target is a @callback row is the type-only leak the gate
// forbids.
//
// @template is the whole of JavaScript's generics, and it deliberately has NO
// relation of its own — the schema puts it in js_type_reference with
// contextKind = TEMPLATE rather than porting ts_type_parameter for 1,013
// comment-borne rows.
//
// Grounded in the platform's `util.callbackify` docs, a charting library's plugin
// typedefs, and the @template usage in Closure-annotated code.

'use strict';

/**
 * The Node error-first callback, declared once and referenced everywhere.
 *
 * @callback NodeCallback
 * @param {Error|null} err
 * @param {*} [result]
 * @returns {void}
 */

/**
 * A callback with named parameters and a real return type.
 *
 * @callback Comparator
 * @param {*} a
 * @param {*} b
 * @returns {number} negative, zero or positive
 */

/**
 * A generic @callback: @template on a callback declaration.
 *
 * @template T, R
 * @callback Mapper
 * @param {T} value
 * @param {number} index
 * @param {Array<T>} array
 * @returns {R}
 */

/**
 * A callback declared with `this`.
 *
 * @callback Handler
 * @this {{ name: string }}
 * @param {Event} event
 * @returns {boolean|void}
 */

/**
 * Uses two of the callbacks above as parameter types. The @param types are
 * references to comment-declared types, which is a normal FK to a js_type row
 * whose only evidence is a comment.
 *
 * @param {Array<*>} items
 * @param {Comparator} compare
 * @param {NodeCallback} done
 * @returns {void}
 */
function sortAsync(items, compare, done) {
  try {
    done(null, items.slice().sort(compare));
  } catch (err) {
    done(err);
  }
}

// --- @template on functions ---------------------------------------------------

/**
 * One type parameter.
 *
 * @template T
 * @param {Array<T>} items
 * @param {Mapper<T, string>} fn
 * @returns {Array<string>}
 */
function mapToStrings(items, fn) {
  return items.map(fn);
}

/**
 * Two parameters on one tag, and a CONSTRAINT — the `@template {Base} T` form,
 * which is TypeScript's `T extends Base` written in JSDoc.
 *
 * @template K, V
 * @template {object} TSource
 * @param {TSource} source
 * @param {K} key
 * @param {V} value
 * @returns {TSource & Record<string, V>}
 */
function withProperty(source, key, value) {
  return Object.assign({}, source, { [key]: value });
}

/**
 * A DEFAULT for a type parameter — `@template [T=string]`.
 *
 * @template [T=string]
 * @param {T} [value]
 * @returns {Array<T>}
 */
function boxed(value) {
  return value === undefined ? [] : [value];
}

/**
 * @template on a class, which is how a generic class is declared in JavaScript.
 * The type parameter is in scope for every member's JSDoc and for nothing in the
 * code.
 *
 * @template T
 */
class Box {
  /**
   * @param {T} value
   */
  constructor(value) {
    /** @type {T} */
    this.value = value;
  }

  /**
   * A method-level type parameter that SHADOWS the class's. Both are named T in
   * real code often enough that the shadowing case has to be covered.
   *
   * @template T
   * @param {function(T): T} fn
   * @returns {Box<T>}
   */
  map(fn) {
    return new Box(fn(/** @type {*} */ (this.value)));
  }

  /**
   * A type parameter constrained by a SIBLING one.
   *
   * @template U
   * @template {keyof U} K
   * @param {U} source
   * @param {K} key
   * @returns {U[K]}
   */
  static pick(source, key) {
    return source[key];
  }
}

/**
 * @template on a typedef whose body uses the parameter twice, and a recursive
 * generic — the deepest type-expression tree in this fixture set.
 *
 * @template T
 * @typedef {{ value: T, next: LinkedNode<T>|null }} LinkedNode
 */

/**
 * Uses the recursive generic.
 *
 * @param {LinkedNode<number>} head
 * @returns {number}
 */
function sumList(head) {
  let total = 0;
  for (let node = head; node !== null; node = node.next) { total += node.value; }
  return total;
}

module.exports = { sortAsync, mapToStrings, withProperty, boxed, Box, sumList };
