'use strict';
// ── platform I/O: a stream created in one function, its callbacks registered in another ──
const fs = require('fs');
function onData(chunk) { return chunk.length; }
function onEnd() { return 0; }
function open() { return fs.createReadStream(__filename); }
function wire(stream) { stream.on('data', onData); stream.on('end', onEnd); return stream; }
function readAll() { return new Promise((resolve) => wire(open()).on('close', () => resolve(1))); }
module.exports = { readAll, onData, onEnd, open, wire };
