'use strict';
const { Base } = require('./base2');
const ns = require('./lib/base');
class A extends ns.Base { a() { return this.id(); } }
new A().a();
