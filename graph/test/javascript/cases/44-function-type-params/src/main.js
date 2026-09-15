// A function literal in a position declared with a JSDoc function type takes its
// parameters' types from that function type (#691).
class Snapshot { hasTimestamps() { return true; } }
class Widget { render() { return 'w'; } }
class Module { identifier() { return 'm'; } }
class Factory { create(type) { return type; } }

class Optimization {
  /**
   * @param {function(Snapshot): boolean} has has value
   * @param {(s: Snapshot, v: Widget) => void} set set value
   */
  constructor(has, set) { this.has = has; this.set = set; }
}
// Argument position.
const opt = new Optimization(s => s.hasTimestamps(), (s, v) => v.render());

// Variable position.
/** @type {(w: Widget) => string} */
const draw = w => w.render();

// Property position through a typedef of members.
/**
 * @typedef {Object} Handlers
 * @property {(w: Widget) => string} paint
 * @property {function(Snapshot): boolean} check
 */
/** @type {Handlers} */
const handlers = {
  paint: w => w.render(),
  check(s) { return s.hasTimestamps(); },
};

// Property position through a GENERIC typedef over Record, applied per member.
/**
 * @template T
 * @template O
 * @typedef {Record<string, (object: O, data: T, factory: Factory) => void>} Extractors
 */
/**
 * @typedef {Object} SimpleExtractors
 * @property {Extractors<Module, Widget>} module
 * @property {Extractors<Snapshot, Widget>} snapshot
 */
/** @type {SimpleExtractors} */
const EXTRACTORS = {
  module: {
    _: (object, module, factory) => { object.render(); module.identifier(); factory.create('x'); },
    extra: (object, module) => module.identifier(),
  },
  snapshot: {
    _: (object, snapshot) => snapshot.hasTimestamps(),
  },
};

// A @callback typedef in argument position.
/**
 * @callback Visitor
 * @param {Widget} w the widget
 * @returns {void}
 */
/** @param {Visitor} visit */
function walk(visit) { return visit; }
walk(w => w.render());

function run() { return [opt, draw, handlers, EXTRACTORS]; }
module.exports = { run };
