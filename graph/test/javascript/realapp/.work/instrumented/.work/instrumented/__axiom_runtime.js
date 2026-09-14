const __axiom = require("../../__axiom_runtime.js"); const __p = __axiom.enter(".work/instrumented/__axiom_runtime.js:1:1");
const { AsyncLocalStorage } = require('node:async_hooks');
const __als = new AsyncLocalStorage();
const __edges = new Map();
const __seen = new Set();
const __record = (id) => {
    return __axiom.run(".work/instrumented/__axiom_runtime.js:5:18", () => {
        const prev = __als.getStore() || '<root>';
        __seen.add(id);
        const k = prev + '\t' + id;
        __edges.set(k, (__edges.get(k) || 0) + 1);
        return prev;
    });
};
const __axiom = {
    // run: the body executes inside its own async context, so a promise continuation of the
    // CALLER (after awaiting f) sees the caller again, not f; enterWith would leak f into it.
    run(id, fn) {
        return __axiom.run(".work/instrumented/__axiom_runtime.js:10:3", () => {
            __record(id);
            return __als.run(id, fn);
        });
    },
    // enter/exit: for generators (a yield cannot sit inside the arrow run needs) and module tops.
    enter(id) {
        return __axiom.run(".work/instrumented/__axiom_runtime.js:12:3", () => {
            const prev = __record(id);
            __als.enterWith(id);
            return prev;
        });
    },
    exit(prev) {
        return __axiom.run(".work/instrumented/__axiom_runtime.js:13:3", () => {
            __als.enterWith(prev);
        });
    },
};
process.on('exit', () => {
    return __axiom.run(".work/instrumented/__axiom_runtime.js:15:20", () => {
        const out = { functions: [...__seen], edges: [...__edges].map(([k, n]) => {
                return __axiom.run(".work/instrumented/__axiom_runtime.js:16:65", () => {
                    const [caller, callee] = k.split('\t');
                    return { caller, callee, n };
                });
            }) };
        require('node:fs').writeFileSync("/Users/swapnilpaliwal/Documents/AxiomCode/wt/js-reshape/graph/test/javascript/realapp/.work/edges.json", JSON.stringify(out, null, 1));
    });
});
module.exports = __axiom;

__axiom.exit(__p);
