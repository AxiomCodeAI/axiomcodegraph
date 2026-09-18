// A JSDoc generic application of a project class or typedef is that class or
// typedef, its arguments ignored (#692).
const LazySet = require('./lazy-set');
class Widget { render() { return 'w'; } }
class Compilation { constructor() { this.graph = new Graph(); } }
class Graph { addReason(m) { return m; } }

/**
 * @template T
 * @typedef {Object} Ctx
 * @property {Compilation} compilation
 * @property {T} options
 */

/** @param {LazySet<string>} set */
function viaClass(set) { return set.addAll(['a']); }
/** @param {Ctx<number>} ctx */
function viaShape(ctx) { return ctx.compilation.graph.addReason('x'); }
/**
 * @param {Widget} module
 * @param {Ctx<number>} ctx
 */
function viaPattern(module, { compilation, compilation: { graph } }) { return graph.addReason(module.render()); }
/** @returns {Promise<Widget>} */
async function viaPromise() { return new Widget(); }
async function usePromise() { return (await viaPromise()).render(); }
module.exports = { viaClass, viaShape, viaPattern, usePromise };
