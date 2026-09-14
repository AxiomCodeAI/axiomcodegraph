'use strict';
function helper() { return 1; }
function Parent() { this.tag = 'p'; }
Parent.prototype.base = function () { return helper(); };
Parent.prototype.describe = function () { return this.base() + this.tag; };
Parent.make = function () { return new this(); };
module.exports = { Parent, helper };
