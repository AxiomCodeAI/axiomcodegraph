'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("lib/asyncy.js:1:1");
// ── promises, async/await, timers, nextTick, callbacks through the platform ──
function delay(v) {
    return __axiom.run("lib/asyncy.js:3:1", () => {
        return new Promise((resolve) => {
            return __axiom.run("lib/asyncy.js:3:40", () => {
                return setTimeout(() => {
                    return __axiom.run("lib/asyncy.js:3:64", () => {
                        return resolve(v);
                    });
                }, 1);
            });
        });
    });
}
function step1(v) {
    return __axiom.run("lib/asyncy.js:4:1", () => {
        return v + 1;
    });
}
function step2(v) {
    return __axiom.run("lib/asyncy.js:5:1", () => {
        return v * 2;
    });
}
function onError(e) {
    return __axiom.run("lib/asyncy.js:6:1", () => {
        return String(e);
    });
}
async function pipeline(v) {
    return __axiom.run("lib/asyncy.js:7:1", async () => {
        const a = await delay(v);
        const b = await Promise.resolve(a).then(step1).then((x) => {
            return __axiom.run("lib/asyncy.js:9:55", () => {
                return step2(x);
            });
        }, onError);
        return b;
    });
}
function later(fn) {
    return __axiom.run("lib/asyncy.js:12:1", () => {
        setImmediate(fn);
        process.nextTick(() => {
            return __axiom.run("lib/asyncy.js:12:57", () => {
                return fn(1);
            });
        });
    });
}
function withCallback(v, cb) {
    return __axiom.run("lib/asyncy.js:13:1", () => {
        cb(null, step1(v));
    });
}
function promisify(f) {
    return __axiom.run("lib/asyncy.js:14:1", () => {
        return (v) => {
            return __axiom.run("lib/asyncy.js:14:32", () => {
                return new Promise((res, rej) => {
                    return __axiom.run("lib/asyncy.js:14:51", () => {
                        return f(v, (err, out) => {
                            return __axiom.run("lib/asyncy.js:14:70", () => {
                                return (err ? rej(err) : res(out));
                            });
                        });
                    });
                });
            });
        };
    });
}
const withCallbackP = promisify(withCallback);
module.exports = { delay, step1, step2, pipeline, later, withCallback, withCallbackP, onError };

__axiom.exit(__p);
