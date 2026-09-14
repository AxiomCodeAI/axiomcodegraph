// A file parsed WITH errors: the compiler recovers, some constructs are absent,
// and every answer about this module is over a subset of it.
const { helper } = require('./helpers');
function broken( { return helper(); }
function reachable() { return helper() + unknownThing(); }
module.exports = { reachable };
