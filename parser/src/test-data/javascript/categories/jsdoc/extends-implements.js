// fixture: cjs/jsdoc/extends-implements.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// Heritage declared in a comment. @extends (and its alias @augments),
// @implements, @interface, @constructor, @lends and @mixes.
//
// The load-bearing case is @extends on a class whose `extends` clause is a CALL
// or a variable: the code cannot name the superclass and the comment can. And
// @implements has NO code counterpart at all — JavaScript has no `implements`,
// so js_type_heritage.inheritsMembers is always true and the interface
// relationship exists only as a comment.
//
// Grounded in a charting library's element classes, a media player's component
// hierarchy, and Closure-annotated code, where @implements is the primary interface mechanism.

'use strict';

const EventEmitter = require('events').EventEmitter;

/**
 * An interface with no runtime existence. @interface makes the class a TYPE and
 * its methods SIGNATURES — the bodies are conventionally empty and are not
 * meant to be called. A parser that treats these as ordinary methods produces
 * call targets nobody can reach.
 *
 * @interface
 */
class Serializable {
  /**
   * @returns {string}
   */
  serialize() { throw new Error('not implemented'); }
}

/**
 * A second interface, declared as a @typedef rather than as a class. Same
 * concept, no code at all.
 *
 * @typedef {Object} Comparable
 * @property {function(*): number} compareTo
 */

/**
 * A class whose heritage is BOTH declared in code and in the comment. They
 * agree here; contradicting-jsdoc.js has the case where they do not.
 *
 * @extends {EventEmitter}
 * @implements {Serializable}
 */
class Emitter extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
  }

  /**
   * @returns {string}
   * @override
   */
  serialize() { return JSON.stringify({ name: this.name }); }
}

/**
 * The case the code cannot express: the superclass is the result of a CALL, so
 * `extends` names no type and isComputedSuperclass is true. The comment supplies
 * what syntax cannot.
 *
 * @template T
 * @extends {Emitter}
 * @implements {Serializable}
 * @implements {Comparable}
 */
class Mixed extends withLogging(Emitter) {
  /** @returns {string} */
  serialize() { return super.serialize(); }
  /** @param {*} other @returns {number} */
  compareTo(other) { return this.name < other.name ? -1 : 1; }
}

/**
 * The mixin factory the class above extends. @mixes records the mixin
 * relationship for a target that gains members by assignment rather than by
 * inheritance.
 *
 * @param {Function} Base
 * @returns {Function}
 */
function withLogging(Base) {
  return class extends Base {
    log(msg) { return '[' + this.name + '] ' + msg; }
  };
}

/**
 * A CONSTRUCTOR FUNCTION with its heritage in the comment. There is no `class`
 * and no `extends` token; @constructor is what makes this a type at all, and
 * @augments (the @extends alias) is the edge.
 *
 * @constructor
 * @augments {Emitter}
 * @param {string} name
 */
function LegacyEmitter(name) {
  Emitter.call(this, name);
}
LegacyEmitter.prototype = Object.create(Emitter.prototype);
LegacyEmitter.prototype.constructor = LegacyEmitter;

/**
 * @lends: the members of this object literal belong to LegacyEmitter's
 * prototype. It is a comment that RETARGETS every declaration in the expression
 * it annotates, which no other tag does.
 */
Object.assign(LegacyEmitter.prototype, /** @lends LegacyEmitter.prototype */ {
  /** @returns {string} */
  serialize() { return 'legacy:' + this.name; },
  /** @type {number} */
  version: 1
});

/**
 * A class implementing an interface declared in ANOTHER FILE, reached by
 * import-type syntax inside the tag.
 *
 * @implements {import('./typedef-only.js').Middleware}
 */
class ImportedInterfaceImpl {
  /** @param {*} req @param {*} res @returns {void} */
  handle(req, res) { return undefined; }
}

/**
 * @implements pointing at a name NOTHING declares. The row names the interface
 * and resolves nothing, which is the only honest answer available.
 *
 * @implements {NeverDeclaredInterface}
 */
class DanglingImplements {}

/**
 * @abstract on a class and on a method. There is no abstract in JavaScript, so
 * js_type.isAbstract stays a parity slot at false; the tag is still written and
 * is still evidence.
 *
 * @abstract
 */
class AbstractBase {
  /** @abstract @returns {void} */
  render() { throw new Error('abstract'); }
}

module.exports = {
  Serializable, Emitter, Mixed, withLogging, LegacyEmitter,
  ImportedInterfaceImpl, DanglingImplements, AbstractBase
};
