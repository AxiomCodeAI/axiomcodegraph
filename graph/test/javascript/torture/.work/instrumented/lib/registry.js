'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("lib/registry.js:1:1");
// ── dynamic dispatch: registries, computed member names, Proxy, reflection ──
const handlers = {
    create(v) {
        return __axiom.run("lib/registry.js:4:3", () => {
            return 'c' + v;
        });
    },
    update(v) {
        return __axiom.run("lib/registry.js:5:3", () => {
            return 'u' + v;
        });
    },
};
function byName(name, v) {
    return __axiom.run("lib/registry.js:7:1", () => {
        return handlers[name](v);
    });
}
function byBracket(v) {
    return __axiom.run("lib/registry.js:8:1", () => {
        return handlers['create'](v);
    });
}
const proxied = new Proxy({}, { get: (t, k) => {
        return __axiom.run("lib/registry.js:9:38", () => {
            return (v) => {
                return __axiom.run("lib/registry.js:9:48", () => {
                    return k + v;
                });
            };
        });
    } });
function viaProxy(v) {
    return __axiom.run("lib/registry.js:10:1", () => {
        return proxied.anything(v);
    });
}
function viaReflect(v) {
    return __axiom.run("lib/registry.js:11:1", () => {
        return Reflect.apply(handlers.update, null, [v]);
    });
}
function viaArguments() {
    return __axiom.run("lib/registry.js:12:1", () => {
        return Array.prototype.slice.call(arguments).map((x) => {
            return __axiom.run("lib/registry.js:12:76", () => {
                return handlers.create(x);
            });
        });
    });
}
function tag(strings, ...vals) {
    return __axiom.run("lib/registry.js:13:1", () => {
        return strings.join('|') + vals.length;
    });
}
function tagged(v) {
    return __axiom.run("lib/registry.js:14:1", () => {
        return tag `a${v}b`;
    });
}
module.exports = { handlers, byName, byBracket, viaProxy, viaReflect, viaArguments, tagged };

__axiom.exit(__p);
