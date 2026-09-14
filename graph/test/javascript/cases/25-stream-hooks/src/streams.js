'use strict';
const { Writable, Readable, Transform, Duplex } = require('stream');
const stream = require('node:stream');
function sink() { return 1; }
class Out extends Writable { _write(chunk, enc, cb) { sink(); cb(); } _final(cb) { sink(); cb(); } _destroy(err, cb) { cb(err); } }
class Src extends Readable { _read() { sink(); this.push(null); } }
class Up extends Transform { _transform(chunk, enc, cb) { sink(); cb(null, chunk); } _flush(cb) { cb(); } }
class Both extends stream.Duplex { _write(c, e, cb) { cb(); } _read() { this.push(null); } }
class SubOut extends Out { extra() { return 2; } }
class Plain { write() { return sink(); } _write() { return 0; } }
module.exports = { Out, Src, Up, Both, SubOut, Plain };
