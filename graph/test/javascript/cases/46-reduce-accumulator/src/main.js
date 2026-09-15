// reduce's accumulator holds the initial value and the callback's returns, and
// the reduce call evaluates to the same (#699).
class Hook { run() { return 1; } }
class Registry { add(h) { this.items = [h]; return this; } list() { return this.items; } }
const hooks = [new Hook(), new Hook()];

function viaLiteral(obj) {
  return Object.keys(obj).reduce((vals, key) => vals.concat([key]), []);   // vals.concat: an array literal's method
}
function viaSet() {
  const set = hooks.reduce((s, hook) => s.add(hook), new Set());   // s.add on the Set
  return set.has(hooks[0]);
}
function viaProject() {
  const reg = hooks.reduce((r, hook) => r.add(hook), new Registry());   // r.add: Registry's
  return reg.list();                                                    // the result is the Registry
}
function viaChain() {
  return hooks.reduce((acc, hook) => { acc.push(hook); return acc; }, []).map(h => h.run());
}
function viaNoInitial() {
  return hooks.reduce((first, hook) => first.run() ? first : hook);   // first is an element
}
function viaRight(obj) {
  return Object.keys(obj).reduceRight((vals, key) => vals.concat([key]), []);
}
module.exports = { viaLiteral, viaSet, viaProject, viaChain, viaNoInitial, viaRight };
