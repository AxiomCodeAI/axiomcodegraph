'use strict';
class Core {}
function core() { return new Core(); }
core.extend = (plugin) => { plugin(Core); return core; };
module.exports = core;
