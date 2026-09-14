'use strict';
// ── dynamic dispatch: registries, computed member names, Proxy, reflection ──
const handlers = {
  create(v) { return 'c' + v; },
  update(v) { return 'u' + v; },
};
function byName(name, v) { return handlers[name](v); }
function byBracket(v) { return handlers['create'](v); }
const proxied = new Proxy({}, { get: (t, k) => (v) => k + v });
function viaProxy(v) { return proxied.anything(v); }
function viaReflect(v) { return Reflect.apply(handlers.update, null, [v]); }
function viaArguments() { return Array.prototype.slice.call(arguments).map((x) => handlers.create(x)); }
function tag(strings, ...vals) { return strings.join('|') + vals.length; }
function tagged(v) { return tag`a${v}b`; }
module.exports = { handlers, byName, byBracket, viaProxy, viaReflect, viaArguments, tagged };
