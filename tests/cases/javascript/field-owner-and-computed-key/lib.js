// fields assigned in a constructor: each owned by its class
class Store {
  constructor() {
    this.items = [];
    this.seq = 0;
  }
  insert(x) {
    this.items.push(x);
    return ++this.seq;
  }
}

// CONTROL: the same field name on another class stays that class's
class Queue {
  constructor() {
    this.items = [];
  }
  push(x) {
    this.items.push(x);
  }
}

// a class field, and members whose key is an expression
class Counter {
  count = 0;
  static [Symbol.hasInstance](x) {
    return typeof x.count === 'number';
  }
  [Symbol.iterator]() {
    return [this.count][Symbol.iterator]();
  }
}

// a constructor function: `this.x` inside it is a field of it
function Legacy(name) {
  this.name = name;
}
Legacy.prototype.describe = function () {
  return this.name;
};

// CONTROL: a module-level binding has no owner
const settings = { debug: false };
let hits = 0;

module.exports = { Store, Queue, Counter, Legacy, settings, hits };
