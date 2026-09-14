'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("lib/bus.js:1:1");
// ── events: EventEmitter subclass, on/once/emit, computed names, a hand-rolled dispatcher ──
const EventEmitter = require('events');
class Bus extends EventEmitter {
    constructor() {
        return __axiom.run("lib/bus.js:5:3", () => {
            super();
            this.handlers = {};
            this.hooks = [];
        });
    }
    start() {
        return __axiom.run("lib/bus.js:6:3", () => {
            this.emit('start', 1);
            this.emit('tick', 2);
            return this;
        });
    }
    fire(name) {
        return __axiom.run("lib/bus.js:7:3", () => {
            this.emit(name, 3);
        });
    }
    hook(fn) {
        return __axiom.run("lib/bus.js:8:3", () => {
            this.hooks.push(fn);
            return this;
        });
    }
    runHooks(v) {
        return __axiom.run("lib/bus.js:9:3", () => {
            return this.hooks.map((h) => {
                return __axiom.run("lib/bus.js:9:39", () => {
                    return h(v);
                });
            });
        });
    }
    register(name, fn) {
        return __axiom.run("lib/bus.js:10:3", () => {
            (this.handlers[name] = this.handlers[name] || []).push(fn);
        });
    }
    dispatch(name, v) {
        return __axiom.run("lib/bus.js:11:3", () => {
            const hs = this.handlers[name] || [];
            return hs.map((h) => {
                return __axiom.run("lib/bus.js:11:75", () => {
                    return h.call(this, v);
                });
            });
        });
    }
}
function onStart(v) {
    return __axiom.run("lib/bus.js:13:1", () => {
        return v;
    });
}
function onTick(v) {
    return __axiom.run("lib/bus.js:14:1", () => {
        return v * 2;
    });
}
function onAny(v) {
    return __axiom.run("lib/bus.js:15:1", () => {
        return v + 1;
    });
}
function hookA(v) {
    return __axiom.run("lib/bus.js:16:1", () => {
        return v + 'a';
    });
}
function hookB(v) {
    return __axiom.run("lib/bus.js:17:1", () => {
        return v + 'b';
    });
}
function handlerX(v) {
    return __axiom.run("lib/bus.js:18:1", () => {
        return this.hooks.length + v;
    });
}
module.exports = { Bus, onStart, onTick, onAny, hookA, hookB, handlerX };

__axiom.exit(__p);
