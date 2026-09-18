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
function main() { direct(); viaVar(); viaPlatform(); viaCtor(); viaProject(); }
main();
