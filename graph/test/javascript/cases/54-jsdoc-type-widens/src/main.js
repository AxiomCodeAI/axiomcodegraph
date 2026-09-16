'use strict';
const registry = require('./registry');
const plain = require('./plain');
function read() { return registry.get('a'); }
function readPlain() { return plain.get('b'); }
function run() { return read() + readPlain(); }
module.exports = { run };
