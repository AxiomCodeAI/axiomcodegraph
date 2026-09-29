'use strict';
// `new this.constructor()` builds the RECEIVER's class at each site, not every
// subclass of the class that declares it.
class Base {
  clone() { return new this.constructor(); }
  copy() { return new Base(); }
  run() { return 'base'; }
}
class Sub extends Base { run() { return 'sub'; } }
class Other extends Base { run() { return 'other'; } }

// The same shape on a constructor function and its prototype.
function Shape() {}
Shape.prototype.dup = function () { return new this.constructor(); };
Shape.prototype.area = function () { return 0; };
function Circle() { Shape.call(this); }
Circle.prototype = Object.create(Shape.prototype);
Circle.prototype.constructor = Circle;
Circle.prototype.area = function () { return 3; };

// The everyday clone: built into a `const`, filled in, returned.
class Query {
  clone() { const q = new this.constructor(); q.opts = this.opts; return q; }
  // Control: a `let` may be rebound before the return, so it keeps its merged value.
  fork() { let q = new this.constructor(); return q; }
  exec() { return 'query'; }
}
class Select extends Query { exec() { return 'select'; } }

function main() {
  new Select().clone().exec();
  new Query().clone().exec();
  new Select().fork().exec();
  new Sub().clone().run();
  new Other().clone().run();
  new Sub().clone().clone().run();
  new Base().clone().run();
  // Control: a fixed `new Base()` stays Base whatever the receiver.
  new Sub().copy().run();
  new Circle().dup().area();
  new Shape().dup().area();
}
main();
