
const { AsyncLocalStorage } = require('node:async_hooks');
const __als = new AsyncLocalStorage();
const __edges = new Map(); const __seen = new Set();
const __record = (id) => { const prev = __als.getStore() || '<root>'; __seen.add(id);
  const k = prev + '\t' + id; __edges.set(k, (__edges.get(k) || 0) + 1); return prev; };
const __axiom = {
  // run: the body executes inside its own async context, so a promise continuation of the
  // CALLER (after awaiting f) sees the caller again, not f; enterWith would leak f into it.
  run(id, fn) { __record(id); return __als.run(id, fn); },
  // enter/exit: for generators (a yield cannot sit inside the arrow run needs) and module tops.
  enter(id) { const prev = __record(id); __als.enterWith(id); return prev; },
  exit(prev) { __als.enterWith(prev); },
};
process.on('exit', () => {
  const out = { functions: [...__seen], edges: [...__edges].map(([k, n]) => { const [caller, callee] = k.split('\t'); return { caller, callee, n }; }) };
  require('node:fs').writeFileSync("/Users/swapnilpaliwal/Documents/AxiomCode/wt/js-reshape/graph/test/javascript/realapp/.work/edges.json", JSON.stringify(out, null, 1));
});
module.exports = __axiom;
