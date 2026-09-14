'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("lib/functional.js:1:1");
// ── closures, currying, higher-order, IIFE, recursion, default/rest params, destructuring ──
function compose(f, g) {
    return __axiom.run("lib/functional.js:3:1", () => {
        return function composed(x) {
            return __axiom.run("lib/functional.js:3:33", () => {
                return f(g(x));
            });
        };
    });
}
const curry = (fn) => {
    return __axiom.run("lib/functional.js:4:15", () => {
        return (a) => {
            return __axiom.run("lib/functional.js:4:23", () => {
                return (b) => {
                    return __axiom.run("lib/functional.js:4:30", () => {
                        return fn(a, b);
                    });
                };
            });
        };
    });
};
function add(a, b) {
    return __axiom.run("lib/functional.js:5:1", () => {
        return a + b;
    });
}
function inc(x) {
    return __axiom.run("lib/functional.js:6:1", () => {
        return add(x, 1);
    });
}
function twice(x) {
    return __axiom.run("lib/functional.js:7:1", () => {
        return add(x, x);
    });
}
const addOne = curry(add)(1);
const incTwice = compose(twice, inc);
function fact(n) {
    return __axiom.run("lib/functional.js:10:1", () => {
        return n <= 1 ? 1 : n * fact(n - 1);
    });
}
const fib = function fibonacci(n) {
    return __axiom.run("lib/functional.js:11:13", () => {
        return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2);
    });
};
const counter = (function () {
    return __axiom.run("lib/functional.js:12:18", () => {
        let n = 0;
        function bump() {
            return __axiom.run("lib/functional.js:14:3", () => {
                n += 1;
                return n;
            });
        }
        return { bump, reset() {
                return __axiom.run("lib/functional.js:15:18", () => {
                    n = 0;
                    return bump();
                });
            } };
    });
})();
function withDefault(cb = () => {
    return __axiom.run("lib/functional.js:17:27", () => {
        return inc(0);
    });
}, { mapper = twice, tag } = {}) {
    return __axiom.run("lib/functional.js:17:1", () => {
        return mapper(cb()) + (tag ? 1 : 0);
    });
}
function variadic(first, ...rest) {
    return __axiom.run("lib/functional.js:18:1", () => {
        return rest.reduce((acc, f) => {
            return __axiom.run("lib/functional.js:18:56", () => {
                return f(acc);
            });
        }, first(0));
    });
}
function applyAll(fns, v) {
    return __axiom.run("lib/functional.js:19:1", () => {
        let out = v;
        for (const f of fns)
            out = f(out);
        return out;
    });
}
function memo(fn) {
    return __axiom.run("lib/functional.js:20:1", () => {
        const cache = new Map();
        return (k) => {
            return __axiom.run("lib/functional.js:20:53", () => {
                if (!cache.has(k))
                    cache.set(k, fn(k));
                return cache.get(k);
            });
        };
    });
}
const slowSquare = memo((x) => {
    return __axiom.run("lib/functional.js:21:25", () => {
        return twice(x) * x;
    });
});
module.exports = { compose, curry, add, inc, twice, addOne, incTwice, fact, fib, counter, withDefault, variadic, applyAll, slowSquare };

__axiom.exit(__p);
