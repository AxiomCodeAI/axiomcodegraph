'use strict';
class Base { run() { return 'base'; } }
function createClient() { return new Base(); }
module.exports = { Base, createClient };
