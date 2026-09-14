// An import the parser could not resolve, by three causes (#617): a computed
// specifier (no static answer exists), a literal that names nothing on disk
// (a staging question), and a platform module (a terminal).
const name = 'x';
const mod = require(name);
const missing = require('./not-here');
const fs = require('fs');
const { helper } = require('./helpers');
function run() { return mod.go() + missing.go() + fs.readFileSync('x') + helper(); }
module.exports = { run };
