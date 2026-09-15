// A collection's KEYS (#659): a declared Map<K, V>'s first type argument, a Set's
// elements, and the object keys written into a plain Map, read back through keys(),
// entries(), the [key, value] pair, and forEach's second parameter.
const { Module, Chunk } = require('./Module');
class Results {
  constructor() {
    /** @type {Map<Module, Chunk>} */
    this.map = new Map();
  }
  keysLoop() { for (const m of this.map.keys()) { m.identifier(); } }
  keysFrom() { return Array.from(this.map.keys(), m => m.identifier()); }
  pairs() { for (const [module, chunk] of this.map) { module.identifier(); chunk.id(); } }
  entries() { for (const [module, chunk] of this.map.entries()) { module.identifier(); chunk.id(); } }
  each() { this.map.forEach((chunk, module) => { module.identifier(); chunk.id(); }); }
  values() { for (const c of this.map.values()) { c.id(); } }
}
/** @param {Map<Module, Chunk>} m */
function param(m) { for (const k of m.keys()) { k.identifier(); } }
/** @param {Set<Module>} s */
function setParam(s) { for (const k of s.keys()) { k.identifier(); } s.forEach((m) => m.identifier()); }
// Object keys written into a plain Map, and a Set's keys.
function plain() {
  const byModule = new Map();
  byModule.set(new Module(), new Chunk());
  for (const [m, c] of byModule) { m.identifier(); c.id(); }
  for (const m of byModule.keys()) { m.identifier(); }
  byModule.forEach((c, m) => { m.identifier(); c.id(); });
  const seeded = new Map([[new Module(), 1]]);
  for (const k of seeded.keys()) { k.identifier(); }
  const set = new Set([new Module()]);
  for (const k of set.keys()) { k.identifier(); }
}
module.exports = { Results, param, setParam, plain };
