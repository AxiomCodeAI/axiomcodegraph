'use strict';
const walk = require('walker');
const https = require('https');
const { Transform } = require('stream');
function keep(x) { return x > 0; }
function visit(x) { return x * 2; }
function connect() { return null; }
function transform(chunk, enc, cb) { cb(null, chunk); }
function localWalk(items, opts) { return items.map((x) => opts.filter(x)); }
function direct() { return walk([1, -1], { filter: keep, hooks: { visit } }); }
function viaVar() { const opts = {}; opts.filter = keep; opts.hooks = { visit }; return walk([2], opts); }
function viaPlatform() { const o = { host: 'localhost', createConnection: connect }; https.request(o).on('error', () => {}).destroy(); }
function viaCtor() { return new Transform({ transform }); }
function viaProject() { return localWalk([1], { filter: keep }); }
// Near misses: the object that holds a function reaches these arguments only through a
// parameter, a property read or a keyed collection — none hands the function over.
const assert = require('assert');
const cache = new Map();
const subs = new Set();
function defineConfig(schema) { const out = {}; for (const k of Object.keys(schema)) out[k] = schema[k].default(); return out; }
const spec = { port: { default: () => 3000 } };
const cfg = defineConfig(spec);
function lookup(key) { return cache.get(key); }
function known(entry) { return subs.has(entry); }
function subscribe(pattern, handler) { const sub = { pattern, handler }; subs.add(sub); cache.set(pattern, sub); return sub; }
function onUpdated() { return 1; }
function check(entry) { assert.equal(spec.port, cfg.port); lookup(spec); known(entry); return walk([entry], {}); }
function viaTimer() { setTimeout(() => keep(1)); [1].forEach(visit); }
// Near miss: iterating a Map of handler sets gives the KEY the handlers too, so the key
// passed to a project matcher or written into an event payload is not a hand-off. The
// handler is reached where it is called.
const byPattern = new Map();
function on(p, h) { let s = byPattern.get(p); if (!s) { s = new Set(); byPattern.set(p, s); } s.add(h); }
function matchesKey(p, topic) { return p === topic; }
function deliver(bus, topic) { for (const [pattern, handlers] of byPattern) { if (!matchesKey(pattern, topic)) continue; bus.emit('seen', { pattern }); for (const h of handlers) h(topic); } }
function bus(ev) { on('a', onUpdated); deliver(ev, 'a'); }
function main() { direct(); viaVar(); viaPlatform(); viaCtor(); viaProject(); check(subscribe('a.*', onUpdated)); viaTimer(); bus(new (require('events'))()); }
main();
// a function wrapped by a package call and kept in a const, then handed to a package registration: registered
function migrate() { return 1; }
const plugin = walk(async () => migrate());
const settings = walk(42);
function viaWrapped() { walk.register(plugin); walk.register(settings); }
module.exports = { viaWrapped };
