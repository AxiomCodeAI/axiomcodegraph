'use strict';
const { Parent } = require('./parent');
function Child() { Parent.call(this); }
Object.setPrototypeOf(Child.prototype, Parent.prototype);
Object.setPrototypeOf(Child, Parent);
Child.prototype.own = function () { return this.base(); };
function GrandChild() { Child.call(this); }
Object.setPrototypeOf(GrandChild.prototype, Child.prototype);
module.exports = { Child, GrandChild };
